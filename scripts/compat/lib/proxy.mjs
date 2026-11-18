// A recording reverse proxy in front of the throwaway MCPHub. Clients talk to the proxy, so the
// harness can see what each client actually put on the wire (which discovery documents it
// fetched, which grant types it used, which protocol headers it sent) without trusting the
// client's own account of itself. The Host header is forwarded untouched, so MCPHub derives its
// issuer and resource URLs from the proxy address, exactly as it would behind a real hostname.
import http from 'node:http';

const BODY_LIMIT = 256 * 1024;

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export const startRecordingProxy = async (targetPort) => {
  const entries = [];

  const server = http.createServer((req, res) => {
    const chunks = [];
    let size = 0;
    const entry = {
      at: Date.now(),
      method: req.method,
      path: (req.url ?? '').split('?')[0],
      authorization: req.headers.authorization ? 'present' : 'absent',
      protocolHeader: req.headers['mcp-protocol-version'],
    };
    entries.push(entry);

    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (upstreamRes) => {
        entry.status = upstreamRes.statusCode;
        if (upstreamRes.headers['www-authenticate']) {
          entry.wwwAuthenticate = upstreamRes.headers['www-authenticate'];
        }
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        if (entry.path === '/oauth/token' && (upstreamRes.statusCode ?? 0) >= 400) {
          // Keep the OAuth error so a failed grant can be told apart from another failed grant.
          const parts = [];
          upstreamRes.on('data', (c) => parts.length < 8 && parts.push(c));
          upstreamRes.on('end', () => {
            const body = parseJson(Buffer.concat(parts).toString('utf8'));
            entry.oauthError = body ? `${body.error}: ${body.error_description ?? ''}`.trim() : undefined;
          });
        }
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', (error) => {
      entry.status = 502;
      entry.proxyError = String(error);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= BODY_LIMIT) chunks.push(chunk);
      upstream.write(chunk);
    });
    req.on('end', () => {
      upstream.end();
      if (!chunks.length) return;
      const text = Buffer.concat(chunks).toString('utf8');
      const contentType = String(req.headers['content-type'] ?? '');
      if (entry.path === '/oauth/token' || entry.path === '/oauth/register') {
        if (contentType.includes('application/json')) {
          const body = parseJson(text) ?? {};
          entry.grantType = body.grant_type;
          entry.registration = entry.path === '/oauth/register' ? body : undefined;
        } else {
          const params = new URLSearchParams(text);
          entry.grantType = params.get('grant_type') ?? undefined;
          entry.hasResource = params.has('resource');
        }
      } else if (contentType.includes('application/json')) {
        const body = parseJson(text);
        const messages = Array.isArray(body) ? body : body ? [body] : [];
        const first = messages.find((m) => m && typeof m.method === 'string');
        if (first) {
          entry.rpcMethod = first.method;
          const meta = first.params?._meta;
          if (meta && typeof meta === 'object') {
            entry.metaProtocolVersion = Object.entries(meta).find(([k]) =>
              /protocolversion/i.test(k),
            )?.[1];
          }
          if (first.method === 'initialize') {
            entry.initializeProtocolVersion = first.params?.protocolVersion;
          }
        }
      }
    });
    req.on('error', () => upstream.destroy());
    res.on('close', () => {
      if (!res.writableEnded) upstream.destroy();
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    entries,
    mark: () => entries.length,
    since: (mark) => entries.slice(mark),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
};
