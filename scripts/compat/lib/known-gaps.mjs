// Failure classification. A failing cell is labelled with the cause so a reader can tell an
// MCPHub defect from a client limitation or a harness limitation without reading logs.
//
//   expected-gap       fixed by a branch that is in flight; expected to fail on main
//   mcphub             an MCPHub defect not covered by an in-flight branch
//   client-limitation  the client stack cannot do this (not an MCPHub problem)
//   harness            the harness cannot exercise this step (not an MCPHub problem)
//
// Rules are matched in order against { client, variant, step, detail }. Anything unmatched is
// reported as `unclassified` so a new failure is never silently attributed to the wrong cause.
export const GAP_BRANCHES = {
  'cimd-advertisement': 'in-flight branch: CIMD advertisement',
  'discovery-endpoints': 'in-flight branch: discovery endpoints (OIDC / path-inserted metadata, iss)',
  'www-authenticate': 'in-flight branch: WWW-Authenticate headers',
  'cimd-token-exchange': 'in-flight branch: CIMD support (resolve CIMD clients when redeeming codes and tokens)',
};

export const KNOWN_RULES = [
  {
    variant: '^cimd(-|$)',
    step: 'register',
    detail: 'did not use the CIMD URL',
    cause: 'expected-gap',
    gap: 'cimd-advertisement',
    note: `${GAP_BRANCHES['cimd-advertisement']}: AS metadata lacks client_id_metadata_document_supported, and every SDK only uses CIMD when it is advertised, so the client falls back to DCR`,
  },
  {
    variant: '^cimdforced',
    step: 'login',
    detail: 'Invalid grant: authorization code is invalid',
    cause: 'expected-gap',
    gap: 'cimd-token-exchange',
    note: `${GAP_BRANCHES['cimd-token-exchange']}: oauthServerService getAuthorizationCode/getRefreshToken look the client up with findOAuthClientById only, so a code issued to a CIMD client can never be redeemed`,
  },
];

export const classify = (entry) => {
  for (const rule of KNOWN_RULES) {
    if (rule.client && rule.client !== entry.client) continue;
    if (rule.variant && !new RegExp(rule.variant).test(entry.variant ?? '')) continue;
    if (rule.step && rule.step !== entry.step) continue;
    if (rule.detail && !new RegExp(rule.detail, 'i').test(entry.detail ?? '')) continue;
    return { cause: rule.cause, note: rule.note, gap: rule.gap };
  }
  return { cause: 'unclassified', note: 'not yet triaged' };
};
