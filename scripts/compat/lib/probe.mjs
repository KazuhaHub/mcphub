// Raw HTTP discovery probe: what any OAuth-capable MCP client sees before it does anything of
// its own. Each check is independent so one gap does not hide the next one.
const get = async (url, init) => {
  const res = await fetch(url, { redirect: 'manual', ...init });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
};

const MCP_ACCEPT = 'application/json, text/event-stream';

export const runDiscoveryProbe = async ({ hubUrl, mcpUrl }) => {
  const checks = [];
  const add = (id, title, ok, detail, gap) =>
    checks.push({ id, title, status: ok ? 'pass' : 'fail', detail, ...(ok || !gap ? {} : { gap }) });

  // 1. The 401 challenge.
  const unauth = await get(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: MCP_ACCEPT },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  const challenge = unauth.headers.get('www-authenticate') ?? '';
  const metadataUrl = challenge.match(/resource_metadata="([^"]+)"/)?.[1];
  add('challenge-401', 'POST /mcp without a token answers 401', unauth.status === 401, `HTTP ${unauth.status}`);
  add(
    'challenge-bearer',
    'WWW-Authenticate uses the Bearer scheme',
    /^Bearer\b/i.test(challenge),
    challenge || 'header missing',
    'www-authenticate',
  );
  add(
    'challenge-resource-metadata',
    'WWW-Authenticate carries resource_metadata (RFC 9728 s5.1)',
    Boolean(metadataUrl),
    metadataUrl ?? challenge ?? 'header missing',
    'www-authenticate',
  );

  const sse = await get(`${hubUrl}/sse`, { headers: { accept: 'text/event-stream' } });
  add(
    'challenge-sse',
    'GET /sse without a token answers 401 with resource_metadata',
    sse.status === 401 && /resource_metadata=/.test(sse.headers.get('www-authenticate') ?? ''),
    `HTTP ${sse.status} ${sse.headers.get('www-authenticate') ?? ''}`.trim(),
    'www-authenticate',
  );

  const bad = await get(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: MCP_ACCEPT, authorization: 'Bearer not-a-real-token' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  add(
    'challenge-invalid-token',
    'An invalid or expired token answers 401 (what triggers a client refresh)',
    bad.status === 401 && /error="invalid_token"/.test(bad.headers.get('www-authenticate') ?? ''),
    `HTTP ${bad.status} ${bad.headers.get('www-authenticate') ?? ''}`.trim(),
    'www-authenticate',
  );

  // 2. Protected resource metadata.
  let asUrl;
  if (metadataUrl) {
    const prm = await get(metadataUrl);
    add('prm-fetch', 'resource_metadata URL serves JSON', prm.status === 200 && Boolean(prm.json), `HTTP ${prm.status}`);
    add('prm-resource', 'PRM `resource` equals the MCP endpoint URL', prm.json?.resource === mcpUrl, `resource=${prm.json?.resource}`);
    asUrl = prm.json?.authorization_servers?.[0];
    add('prm-as', 'PRM lists an authorization server', Boolean(asUrl), JSON.stringify(prm.json?.authorization_servers));
  }
  const prmRoot = await get(`${hubUrl}/.well-known/oauth-protected-resource`);
  add('prm-root', 'Root PRM fallback (/.well-known/oauth-protected-resource) serves JSON', prmRoot.status === 200, `HTTP ${prmRoot.status}`);
  asUrl ??= prmRoot.json?.authorization_servers?.[0] ?? hubUrl;

  // 3. Authorization server metadata, at every location a client may try (RFC 8414 s3, OIDC Discovery).
  const issuer = new URL(asUrl);
  const issuerPath = issuer.pathname.replace(/\/+$/, '');
  const rfc8414 = `${issuer.origin}/.well-known/oauth-authorization-server${issuerPath}`;
  const oidcInserted = `${issuer.origin}/.well-known/openid-configuration${issuerPath}`;
  const oidcAppended = `${asUrl.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  const as = await get(rfc8414);
  add('as-rfc8414', `AS metadata at ${new URL(rfc8414).pathname}`, as.status === 200 && Boolean(as.json), `HTTP ${as.status}`);
  // The spec requires one of RFC 8414 or OIDC discovery and has clients try both, so a hub that
  // offers only RFC 8414 must answer the OIDC URLs with JSON (a document, or a 404), never with
  // the dashboard's HTML, which a client would try to parse as metadata.
  const oidcAnswersJson = (r) =>
    (r.status === 200 || (r.status === 404 && as.status === 200)) && Boolean(r.json);
  const oidc1 = await get(oidcInserted);
  add(
    'as-oidc',
    `OIDC discovery URL ${new URL(oidcInserted).pathname} answers JSON (a document, or a 404 when only RFC 8414 is offered)`,
    oidcAnswersJson(oidc1),
    `HTTP ${oidc1.status}${oidc1.json ? ' JSON' : ' non-JSON'}`,
    'discovery-endpoints',
  );
  if (oidcAppended !== oidcInserted) {
    const oidc2 = await get(oidcAppended);
    add(
      'as-oidc-appended',
      `OIDC discovery URL ${new URL(oidcAppended).pathname} answers JSON`,
      oidcAnswersJson(oidc2),
      `HTTP ${oidc2.status}${oidc2.json ? ' JSON' : ' non-JSON'}`,
      'discovery-endpoints',
    );
  }

  const meta = as.json ?? {};
  add('as-issuer', 'metadata `issuer` equals the authorization server URL', meta.issuer === asUrl.replace(/\/+$/, ''), `issuer=${meta.issuer}`);
  add('as-endpoints', 'authorization, token and registration endpoints advertised', Boolean(meta.authorization_endpoint && meta.token_endpoint && meta.registration_endpoint), `registration_endpoint=${meta.registration_endpoint ?? 'missing'}`);
  add('as-pkce', 'code_challenge_methods_supported includes S256', (meta.code_challenge_methods_supported ?? []).includes('S256'), JSON.stringify(meta.code_challenge_methods_supported));
  add('as-refresh', 'grant_types_supported includes refresh_token', (meta.grant_types_supported ?? []).includes('refresh_token'), JSON.stringify(meta.grant_types_supported));
  add('as-public-client', 'token_endpoint_auth_methods_supported includes "none"', (meta.token_endpoint_auth_methods_supported ?? []).includes('none'), JSON.stringify(meta.token_endpoint_auth_methods_supported));
  add(
    'as-cimd',
    'client_id_metadata_document_supported is true (clients only try CIMD when advertised)',
    meta.client_id_metadata_document_supported === true,
    `client_id_metadata_document_supported=${meta.client_id_metadata_document_supported}`,
    'cimd-advertisement',
  );
  add(
    'as-iss',
    'authorization_response_iss_parameter_supported is true (RFC 9207)',
    meta.authorization_response_iss_parameter_supported === true,
    `authorization_response_iss_parameter_supported=${meta.authorization_response_iss_parameter_supported}`,
    'discovery-endpoints',
  );

  const required = checks.filter((c) => !c.gap);
  const failed = checks.filter((c) => c.status === 'fail');
  return {
    checks,
    summary: {
      passed: checks.length - failed.length,
      failed: failed.length,
      requiredFailed: required.filter((c) => c.status === 'fail').length,
    },
  };
};
