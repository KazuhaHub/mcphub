import type { Request } from 'express';
import { flowCookieName, flowIsSecure, flowNonceReader } from '../../src/utils/oauthFlowBinding.js';

const req = (cookie: string) => ({ headers: { cookie } }) as unknown as Request;

describe('personal OAuth flow cookie', () => {
  it('is per flow and host-locked on https', () => {
    expect(flowCookieName('state-a', true)).toMatch(/^__Host-mcphub_oauth_flow_[0-9a-f]{16}$/);
    expect(flowCookieName('state-a', false)).toMatch(/^mcphub_oauth_flow_[0-9a-f]{16}$/);
    expect(flowCookieName('state-a', true)).not.toBe(flowCookieName('state-b', true));
  });

  it('reads only the variant the callback scheme dictates', () => {
    const plain = flowCookieName('s', false);
    const host = flowCookieName('s', true);
    const read = flowNonceReader(req(`${plain}=planted; other=1`));
    expect(read('s', true)).toBeUndefined();
    expect(read('s', false)).toBe('planted');
    expect(flowNonceReader(req(`${host}=real`))('s', true)).toBe('real');
  });

  it('takes the scheme from the redirect_uri of the authorization URL', () => {
    const url = (redirect: string) =>
      `https://as.example/authorize?redirect_uri=${encodeURIComponent(redirect)}&state=s`;
    expect(flowIsSecure(url('https://hub.example/oauth/callback'))).toBe(true);
    expect(flowIsSecure(url('http://localhost:3000/oauth/callback'))).toBe(false);
    expect(flowIsSecure(undefined)).toBe(false);
  });
});
