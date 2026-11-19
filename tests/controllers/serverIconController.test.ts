import { Request, Response } from 'express';

const findById = jest.fn();
jest.mock('../../src/dao/DaoFactory.js', () => ({
  getServerDao: jest.fn(() => ({ findById })),
}));

// Visibility is decided by the real rule the server list uses.
jest.mock('../../src/services/userContextService.js', () => ({
  UserContextService: { getInstance: () => ({ getCurrentUser: () => null }) },
}));

import { getServerIcon } from '../../src/controllers/serverIconController.js';
import { serverIconUrl } from '../../src/utils/serverIcon.js';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('px'),
]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const url = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;
const versionOf = (name: string, icon: string) => serverIconUrl(name, icon, '')!.split('?v=')[1];

const run = async (
  name: string,
  user: unknown,
  headers: Record<string, string> = {},
  query: Record<string, string> = {},
) => {
  const sent: { status?: number; headers: Record<string, string>; body?: unknown; json?: any } = {
    headers: {},
  };
  const res = {
    setHeader: (k: string, v: string) => void (sent.headers[k.toLowerCase()] = v),
    status: (code: number) => {
      sent.status = code;
      return res;
    },
    json: (body: unknown) => void (sent.json = body),
    end: (body?: unknown) => void (sent.body = body),
  } as unknown as Response;
  await getServerIcon({ params: { name }, headers, query, user } as unknown as Request, res);
  return sent;
};

const alice = { username: 'alice', isAdmin: false, userGroups: ['eng'] };

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockImplementation(async (name: string) =>
    name === 'notes'
      ? { name: 'notes', owner: 'alice', visibility: 'private', icon: url('image/png', png) }
      : name === 'drawing'
        ? { name: 'drawing', owner: 'bob', visibility: 'public', icon: url('image/svg+xml', svg) }
        : name === 'plain'
          ? { name: 'plain', owner: 'bob', visibility: 'public' }
          : null,
  );
});

describe('GET /api/servers/:name/icon', () => {
  it('serves the bytes with type, nosniff, a strong ETag and a private immutable cache for the matching version', async () => {
    const icon = url('image/png', png);
    const sent = await run('notes', alice, {}, { v: versionOf('notes', icon) });
    expect(sent.status).toBe(200);
    expect((sent.body as Buffer).equals(png)).toBe(true);
    expect(sent.headers['content-type']).toBe('image/png');
    expect(sent.headers['x-content-type-options']).toBe('nosniff');
    expect(sent.headers['etag']).toMatch(/^"[0-9a-f]{64}"$/);
    expect(sent.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(sent.headers['content-security-policy']).toBeUndefined();
  });

  it('revalidates when no version is given and never stores a mismatched version', async () => {
    expect((await run('notes', alice)).headers['cache-control']).toBe('private, no-cache');
    for (const v of ['000000000000', 'zzz', '']) {
      const sent = await run('notes', alice, {}, { v });
      expect(sent.status).toBe(200);
      expect(sent.headers['cache-control']).toBe('no-store');
    }
  });

  it('answers 304 to a matching If-None-Match', async () => {
    const first = await run('notes', alice);
    const sent = await run('notes', alice, { 'if-none-match': first.headers['etag'] });
    expect(sent.status).toBe(304);
    expect(sent.body).toBeUndefined();
  });

  it('serves an SVG with a sandboxing CSP so opening it directly runs no script', async () => {
    const sent = await run('drawing', alice);
    expect(sent.status).toBe(200);
    expect(sent.headers['content-type']).toBe('image/svg+xml');
    expect(sent.headers['content-security-policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  });

  describe('visibility', () => {
    const iconOf = url('image/png', png);
    const server = (extra: object) => ({ name: 'vis', owner: 'bob', icon: iconOf, ...extra });
    const statusFor = async (record: object, user: unknown) => {
      findById.mockResolvedValue(record);
      return (await run('vis', user)).status;
    };

    it('serves the owner, an admin and anyone for a public server', async () => {
      expect(await statusFor(server({ visibility: 'private' }), { username: 'bob' })).toBe(200);
      expect(
        await statusFor(server({ visibility: 'private' }), { username: 'root', isAdmin: true }),
      ).toBe(200);
      expect(await statusFor(server({ visibility: 'public' }), alice)).toBe(200);
    });

    it('serves a shared user or user group member of a group server, and nobody else', async () => {
      const shared = server({ visibility: 'group', sharedWithUsers: ['alice'] });
      expect(await statusFor(shared, alice)).toBe(200);
      expect(await statusFor(shared, { username: 'carol', userGroups: [] })).toBe(404);
      const grouped = server({ visibility: 'group', sharedWithUserGroups: ['eng'] });
      expect(await statusFor(grouped, alice)).toBe(200);
      expect(await statusFor(grouped, { username: 'carol', userGroups: ['ops'] })).toBe(404);
    });

    it('answers 404 for a private server of someone else, exactly like an unknown name', async () => {
      const hidden = await (async () => {
        findById.mockResolvedValue(server({ visibility: 'private' }));
        return run('vis', alice);
      })();
      findById.mockResolvedValue(null);
      const unknown = await run('vis', alice);
      expect(hidden.status).toBe(404);
      expect(hidden.json).toEqual(unknown.json);
      expect(hidden.headers).toEqual(unknown.headers);
      expect(hidden.body).toBeUndefined();
    });
  });

  it.each([
    ['an unknown server', 'missing'],
    ['a server without an icon', 'plain'],
  ])('answers 404 for %s', async (_label, name) => {
    const sent = await run(name, alice);
    expect(sent.status).toBe(404);
    expect(sent.json).toEqual({ success: false, message: 'Icon not found' });
    expect(sent.headers['cache-control']).toBe('no-cache');
  });

  it('answers 404 without a signed-in user', async () => {
    expect((await run('notes', undefined)).status).toBe(404);
  });

  it('answers 500 without detail when the lookup fails', async () => {
    findById.mockRejectedValueOnce(new Error('db down: secret'));
    const sent = await run('notes', alice);
    expect(sent.status).toBe(500);
    expect(JSON.stringify(sent.json)).not.toContain('secret');
  });
});
