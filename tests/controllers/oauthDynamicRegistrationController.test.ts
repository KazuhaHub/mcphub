import { Request, Response } from 'express';

const getSystemConfigMock = jest.fn();
const createOAuthClientMock = jest.fn();
const findOAuthClientByIdMock = jest.fn();
const updateOAuthClientMock = jest.fn();
const deleteOAuthClientMock = jest.fn();

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getSystemConfigDao: jest.fn(() => ({
    get: getSystemConfigMock,
  })),
}));

jest.mock('../../src/models/OAuth.js', () => ({
  createOAuthClient: createOAuthClientMock,
  findOAuthClientById: findOAuthClientByIdMock,
  updateOAuthClient: updateOAuthClientMock,
  deleteOAuthClient: deleteOAuthClientMock,
  createRegistrationToken: jest.fn(() => 'test-registration-token'),
  verifyRegistrationToken: jest.fn(() => 'test-client'),
  deleteRegistrationToken: jest.fn(),
}));

const mockAuthMiddleware = jest.fn((req, res, next) => next());

jest.mock('../../src/middlewares/auth.js', () => ({
  auth: (...args: [unknown, unknown, () => void]) => mockAuthMiddleware(...args),
}));

import {
  registerClient,
  updateClientConfiguration,
} from '../../src/controllers/oauthDynamicRegistrationController.js';

describe('oauthDynamicRegistrationController - registerClient', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();

    mockRequest = {
      protocol: 'https',
      get: jest.fn().mockReturnValue('localhost:3000'),
      body: {
        redirect_uris: ['https://client.example.com/callback'],
        client_name: 'Test Dynamic Client',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'read write',
      },
    };

    mockResponse = {
      json: mockJson,
      status: mockStatus,
    };

    getSystemConfigMock.mockResolvedValue({
      install: {
        baseUrl: 'https://mcp.example.com/hub',
      },
      oauthServer: {
        enabled: true,
        allowedScopes: ['read', 'write'],
        dynamicRegistration: {
          enabled: true,
          allowedGrantTypes: ['authorization_code', 'refresh_token'],
        },
      },
    });

    createOAuthClientMock.mockImplementation(async (client) => client);
  });

  it('uses DAO-backed oauthServer and install settings when registering clients', async () => {
    await registerClient(mockRequest as Request, mockResponse as Response);

    expect(createOAuthClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Dynamic Client',
        redirectUris: ['https://client.example.com/callback'],
        grants: ['authorization_code', 'refresh_token'],
        scopes: ['read', 'write'],
      }),
    );

    expect(mockStatus).toHaveBeenCalledWith(201);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        client_name: 'Test Dynamic Client',
        redirect_uris: ['https://client.example.com/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        scope: 'read write',
        registration_client_uri: expect.stringMatching(
          /^https:\/\/mcp\.example\.com\/hub\/oauth\/register\/[0-9a-f]+$/,
        ),
      }),
    );
  });
});

describe('registerClient follows the advertised metadata for partial oauthServer blocks', () => {
  const run = async (oauthServer: unknown) => {
    getSystemConfigMock.mockResolvedValue({ oauthServer });
    createOAuthClientMock.mockImplementation(async (client) => client);
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    await registerClient(
      {
        protocol: 'https',
        get: jest.fn().mockReturnValue('localhost:3000'),
        body: {
          redirect_uris: ['https://client.example.com/callback'],
          client_name: 'Partial Config Client',
        },
      } as unknown as Request,
      { status, json } as unknown as Response,
    );
    return { status, json };
  };

  beforeEach(() => jest.clearAllMocks());

  it('registers when only some oauthServer fields are stored (defaults enable registration)', async () => {
    const { status } = await run({ enabled: true, accessTokenLifetime: 10 });
    expect(status).toHaveBeenCalledWith(201);
    expect(createOAuthClientMock).toHaveBeenCalled();
  });

  it('still refuses when registration is explicitly disabled', async () => {
    const { status } = await run({ enabled: true, dynamicRegistration: { enabled: false } });
    expect(status).toHaveBeenCalledWith(403);
    expect(createOAuthClientMock).not.toHaveBeenCalled();
  });

  it('refuses when the OAuth server itself is disabled', async () => {
    const { status } = await run({ enabled: false });
    expect(status).toHaveBeenCalledWith(403);
    expect(createOAuthClientMock).not.toHaveBeenCalled();
  });
});

describe('registerClient requiresAuthentication gate', () => {
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Restore default pass-through behavior cleared by the outer clearAllMocks
    mockAuthMiddleware.mockImplementation((req, res, next) => next());

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();
    mockRequest = {
      protocol: 'https',
      get: jest.fn().mockReturnValue('localhost:3000'),
      body: {
        redirect_uris: ['https://client.example.com/callback'],
        client_name: 'Gated Client',
      },
    };
    mockResponse = { json: mockJson, status: mockStatus };

    getSystemConfigMock.mockResolvedValue({
      oauthServer: {
        enabled: true,
        allowedScopes: ['read', 'write'],
        dynamicRegistration: {
          enabled: true,
          requiresAuthentication: true,
        },
      },
    });
    createOAuthClientMock.mockImplementation(async (client) => client);
  });

  it('rejects unauthenticated registrations with 401 when requiresAuthentication is set', async () => {
    mockAuthMiddleware.mockImplementationOnce((_req, res, _next) => {
      (res as unknown as { status: (n: number) => unknown; json: (b: unknown) => unknown })
        .status(401)
        .json({ error: 'invalid_token' });
    });

    await registerClient(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).toHaveBeenCalledWith(401);
    expect(createOAuthClientMock).not.toHaveBeenCalled();
  });

  it('registers normally when a credential resolves to a user', async () => {
    (mockRequest as { user?: unknown }).user = { username: 'alice', isAdmin: false };

    await registerClient(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).toHaveBeenCalledWith(201);
    expect(createOAuthClientMock).toHaveBeenCalledTimes(1);
  });
});

describe('registration accepts the scopes of configured external resources', () => {
  const externalResources = [
    {
      resource: 'https://rackbook.example/mcp',
      name: 'Rackbook',
      scopes: ['rackbook:write'],
    },
  ];

  const register = async (scope: string, allowedScopes = ['read', 'write']) => {
    getSystemConfigMock.mockResolvedValue({
      oauthServer: { enabled: true, allowedScopes, externalResources },
    });
    createOAuthClientMock.mockImplementation(async (client) => client);
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    await registerClient(
      {
        protocol: 'https',
        get: jest.fn().mockReturnValue('localhost:3000'),
        body: {
          redirect_uris: ['https://client.example.com/callback'],
          client_name: 'Scoped Client',
          scope,
        },
      } as unknown as Request,
      { status, json } as unknown as Response,
    );
    return { status, json };
  };

  beforeEach(() => jest.clearAllMocks());

  it('registers a client asking for a scope an external resource lists', async () => {
    const { status } = await register('rackbook:write');
    expect(status).toHaveBeenCalledWith(201);
    expect(createOAuthClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ['rackbook:write'] }),
    );
  });

  it('accepts MCPHub scopes and external resource scopes together', async () => {
    const { status } = await register('read rackbook:write');
    expect(status).toHaveBeenCalledWith(201);
  });

  it('still refuses a scope that neither allowedScopes nor any resource lists', async () => {
    const { status, json } = await register('rackbook:admin');
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'invalid_client_metadata',
        error_description: 'Scope not allowed: rackbook:admin',
      }),
    );
    expect(createOAuthClientMock).not.toHaveBeenCalled();
  });

  it('applies the same rule when a registration is updated', async () => {
    getSystemConfigMock.mockResolvedValue({
      oauthServer: { enabled: true, externalResources },
    });
    findOAuthClientByIdMock.mockResolvedValue({
      clientId: 'test-client',
      name: 'Scoped Client',
      redirectUris: ['https://client.example.com/callback'],
      grants: ['authorization_code'],
      scopes: ['read'],
    });
    updateOAuthClientMock.mockImplementation(async (_id, updates) => ({
      clientId: 'test-client',
      name: 'Scoped Client',
      redirectUris: ['https://client.example.com/callback'],
      grants: ['authorization_code'],
      ...updates,
    }));
    const run = async (scope: string) => {
      const status = jest.fn().mockReturnThis();
      const json = jest.fn();
      await updateClientConfiguration(
        {
          params: { clientId: 'test-client' },
          headers: { authorization: 'Bearer test-registration-token' },
          body: { scope },
        } as unknown as Request,
        { status, json } as unknown as Response,
      );
      return { status, json };
    };

    const ok = await run('rackbook:write');
    expect(ok.status).not.toHaveBeenCalled();
    expect(updateOAuthClientMock).toHaveBeenCalledWith(
      'test-client',
      expect.objectContaining({ scopes: ['rackbook:write'] }),
    );
    const refused = await run('rackbook:admin');
    expect(refused.status).toHaveBeenCalledWith(400);
  });
});
