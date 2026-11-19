import type { Request, Response } from 'express';
import { LegacyMcpClient } from '../clients/legacyMcpClient.js';
import { getServerDao } from '../dao/DaoFactory.js';
import { authorizationService, type RequestPrincipal } from '../services/authorizationService.js';
import { credentialBindingEvents } from '../services/credentialBindingService.js';
import {
  PersonalOAuthContext,
  hasPersonalOAuth,
  findPersonalOAuthFlow,
  disconnectPersonalOAuth,
} from '../services/personalOAuthService.js';
import { notifyWorkspaceUser } from '../services/userServerStatusService.js';
import { createTransportFromConfig } from '../services/mcpService.js';
import { validateAuthorizationIss } from '../utils/oauthIssuer.js';
import { CredentialBindingError } from '../utils/credentialTemplate.js';
import { resolveSelfResource, revokeSelfGrants } from '../services/selfOAuthResource.js';
import { getAuthorizationCode } from '../models/OAuth.js';
import { logger } from '../utils/logger.js';
import {
  flowNonceMatches,
  hashFlowNonce,
  newFlowNonce,
  setFlowCookie,
  flowIsSecure,
} from '../utils/oauthFlowBinding.js';

export const managePersonalOAuth = async (req: Request, res: Response): Promise<void> => {
  const user = (req as Request & { user?: RequestPrincipal }).user;
  if (!user?.username || user.credentialEligible === false) {
    res.status(401).json({ success: false });
    return;
  }
  try {
    const definition = await getServerDao().findById(req.params.name);
    if (
      !definition ||
      !hasPersonalOAuth(definition) ||
      definition.enabled === false ||
      !authorizationService.can('server.invoke', definition, user)
    ) {
      res.status(404).json({ success: false, message: 'Server not available' });
      return;
    }
    if (req.method === 'DELETE') {
      // Revocation is best effort: unreadable tokens must not prevent local disconnect.
      const binding = await PersonalOAuthContext.load(
        definition.name,
        user.username,
        definition,
      ).catch(() => undefined);
      await disconnectPersonalOAuth(definition.name, user.username);
      const oauth = binding?.config.oauth;
      // A server whose authorization server is this hub: end the grant there too.
      const selfResource = await resolveSelfResource(definition);
      if (selfResource) {
        await revokeSelfGrants(user.username, [
          selfResource.entry.resource,
          oauth?.grantResource,
        ]).catch(() => undefined);
      }
      if (binding && oauth?.revocationEndpoint) {
        const { revokeToken, canServerOwnerReachInternalUrls } = await import(
          '../services/upstreamOAuthDisconnectService.js'
        );
        const allowInternal = await canServerOwnerReachInternalUrls(definition);
        await Promise.all(
          (
            [
              ['access_token', oauth.accessToken],
              ['refresh_token', oauth.refreshToken],
            ] as const
          )
            .filter((pair): pair is readonly ['access_token' | 'refresh_token', string] =>
              Boolean(pair[1]),
            )
            .map(([hint, token]) =>
              revokeToken(
                oauth.revocationEndpoint!,
                binding.config,
                { hint, token },
                allowInternal,
              ),
            ),
        );
      }
      await notifyWorkspaceUser(user.username);
      res.json({ success: true });
      return;
    }
    const context = await PersonalOAuthContext.load(definition.name, user.username, definition);
    if (req.method === 'POST') {
      // Starting a new flow supersedes the previous flow and invalidates live sessions.
      const selfResource = await resolveSelfResource(definition);
      if (selfResource) {
        await revokeSelfGrants(user.username, [
          selfResource.entry.resource,
          context.config.oauth.grantResource,
        ]).catch(() => undefined);
      }
      await context.clearOAuthData(definition.name, 'tokens');
      await context.clearOAuthData(definition.name, 'verifier');
      credentialBindingEvents.emit('invalidate', {
        serverName: definition.name,
        username: user.username,
      });
      const config = context.config;
      if (config.type === 'openapi') {
        const { MCPHubOAuthProvider } = await import('../services/mcpOAuthProvider.js');
        const provider = await MCPHubOAuthProvider.create(definition.name, config);
        await provider.startOpenApiAuthorization();
      } else {
        const transport = await createTransportFromConfig(definition.name, config);
        const client = new LegacyMcpClient({ name: 'mcphub-personal-oauth', version: '1.0.0' });
        try {
          await client.connect(transport);
        } catch {
          if (!context.config.oauth.pendingAuthorization?.authorizationUrl)
            throw new Error('Authorization discovery failed');
        } finally {
          await client.close().catch(() => undefined);
          await transport.close().catch(() => undefined);
        }
      }
    }
    if (req.method === 'POST') {
      // Tie the new flow to this browser: only a callback carrying the cookie set here completes it.
      const pending = context.config.oauth.pendingAuthorization;
      if (pending?.state) {
        const nonce = newFlowNonce();
        await context.mutate(({ oauth }) => {
          if (oauth.pendingAuthorization)
            oauth.pendingAuthorization.browserBinding = hashFlowNonce(nonce);
        });
        setFlowCookie(res, nonce, pending.state, pending.authorizationUrl);
      }
      await notifyWorkspaceUser(user.username);
    }
    let authorizationUrl = context.authorizationUrl;
    if (authorizationUrl && context.config.oauth.authorizationRelay) {
      const callback = new URL(authorizationUrl).searchParams.get('redirect_uri');
      if (!callback) throw new Error('Missing authorization callback');
      const relay = new URL(`relay/${encodeURIComponent(definition.name)}`, callback);
      relay.searchParams.set('state', context.config.oauth.pendingAuthorization!.state!);
      authorizationUrl = relay.toString();
    }
    res.json({
      success: true,
      data: {
        connected: Boolean(context.config.oauth.accessToken),
        authorizationUrl,
        status: context.config.oauth.accessToken ? 'connected' : 'oauth_required',
      },
    });
  } catch (error) {
    res.status(error instanceof CredentialBindingError ? 400 : 502).json({
      success: false,
      message:
        error instanceof CredentialBindingError
          ? error.message
          : 'Unable to prepare personal authorization',
    });
  }
};

/** What the callback request proves about the browser that delivers it. */
export interface PersonalOAuthCallbackProof {
  /** Reads the flow's cookie by state and callback scheme (`flowNonceReader(req)`). */
  readNonce?: (state: string, secure: boolean) => string | undefined;
  /** A nonce given directly; for callers that already read the right cookie (tests). */
  nonce?: string;
}

const refuseFlow = async (context: PersonalOAuthContext, reason: string): Promise<never> => {
  logger.warn(
    `Personal OAuth callback refused (${reason}) for '${context.serverName}', flow owner '${context.username}'; the flow was discarded`,
  );
  await context.clearOAuthData(context.serverName, 'verifier').catch(() => undefined);
  throw new CredentialBindingError('Invalid authorization state');
};

export const completePersonalOAuth = async (
  state: string,
  code: string,
  iss?: string,
  proof: PersonalOAuthCallbackProof = {},
): Promise<boolean> => {
  const context = await findPersonalOAuthFlow(state);
  if (!context) return false;
  const pending = context.config.oauth.pendingAuthorization!;
  // `state` only finds the flow. Completing it takes the browser that started it: the cookie set
  // for this flow, read under the name its callback scheme dictates.
  const nonce = proof.readNonce
    ? proof.readNonce(state, flowIsSecure(pending.authorizationUrl))
    : proof.nonce;
  if (!flowNonceMatches(pending.browserBinding, nonce))
    return refuseFlow(context, 'the browser did not start this flow');
  const result = validateAuthorizationIss({
    iss,
    authorizationUrl: pending.authorizationUrl,
    configuredIssuer: pending.issuer || context.config.oauth.dynamicRegistration?.issuer,
    issRequired: pending.issRequired,
  });
  if (!result.valid) throw new CredentialBindingError('Invalid authorization issuer');
  // This hub's own authorization server issued the code for a known user: it must be the owner.
  if (await resolveSelfResource(context.config)) {
    const issued = await getAuthorizationCode(code);
    if (!issued || issued.username !== context.username)
      return refuseFlow(context, 'the code was issued for another user');
  }
  // Persist consumption before redeeming the code: concurrent/replayed callbacks fail closed.
  await context.mutate(({ oauth }) => {
    delete oauth.pendingAuthorization!.state;
  });
  const config = context.config;
  if (config.type === 'openapi') {
    const { MCPHubOAuthProvider } = await import('../services/mcpOAuthProvider.js');
    const provider = await MCPHubOAuthProvider.create(context.serverName, config);
    await provider.finishOpenApiAuthorization(code, iss);
    credentialBindingEvents.emit('invalidate', {
      serverName: context.serverName,
      username: context.username,
    });
    return true;
  }
  const transport = await createTransportFromConfig(context.serverName, config);
  try {
    if (!('finishAuth' in transport)) throw new Error('OAuth transport required');
    await (transport as { finishAuth: (code: string, iss?: string) => Promise<void> }).finishAuth(
      code,
      iss,
    );
    credentialBindingEvents.emit('invalidate', {
      serverName: context.serverName,
      username: context.username,
    });
    await notifyWorkspaceUser(context.username);
    return true;
  } finally {
    await transport.close().catch(() => undefined);
  }
};
