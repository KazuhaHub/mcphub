// In-process upstream MCP server (stateless streamable HTTP on loopback). Using the repo's own
// MCP server package means no npx/uvx and no network: the only thing under test is MCPHub.
import http from 'node:http';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { Server } from '@modelcontextprotocol/server';

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo a message back',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  },
];

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });

export const startUpstream = async () => {
  const server = http.createServer(async (req, res) => {
    try {
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      const upstream = new Server(
        { name: 'compat-upstream', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );
      upstream.setRequestHandler('tools/list', async () => ({ tools: TOOLS }));
      upstream.setRequestHandler('tools/call', async (request) => ({
        content: [{ type: 'text', text: `echo: ${request.params.arguments?.message ?? ''}` }],
      }));
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void upstream.close();
      });
      await upstream.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500).end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
};
