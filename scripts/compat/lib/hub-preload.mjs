// Preloaded into the throwaway MCPHub process (never into the repo's own runtime). It uses the two
// test seams MCPHub already exposes for CIMD so the harness can serve a client metadata document
// for a fake HTTPS client_id: MCPHub's SSRF guard refuses loopback hosts, so a real fetch of a
// local document is impossible without weakening that guard, which the harness must not do.
// Everything after the document fetch (validation, redirect_uri matching, PKCE enforcement,
// consent, code and token issuance) is MCPHub's real code.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const clientId = process.env.COMPAT_CIMD_CLIENT_ID;
const document = process.env.COMPAT_CIMD_DOCUMENT;

if (clientId && document) {
  const hubRoot = process.env.COMPAT_HUB_ROOT;
  const { setCimdDnsLookupForTesting, setCimdFetchImplForTesting } = await import(
    pathToFileURL(path.join(hubRoot, 'src', 'services', 'cimdClientService.ts')).href
  );
  setCimdDnsLookupForTesting(async () => ['93.184.216.34']);
  setCimdFetchImplForTesting(async (input) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    if (url === clientId) {
      return new Response(document, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  });
}
