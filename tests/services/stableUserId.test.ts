import fs from 'fs';
import os from 'os';
import path from 'path';

import { UserDaoImpl } from '../../src/dao/UserDao.js';
import { clearSettingsCache } from '../../src/config/index.js';

let dao: UserDaoImpl;
jest.mock('../../src/dao/index.js', () => ({ getUserDao: () => dao }));

import { resolveStableUserId } from '../../src/services/stableUserId.js';

describe('resolveStableUserId (file mode)', () => {
  let tmpDir: string;
  let settingsPath: string;
  let originalSettingsEnv: string | undefined;
  const stored = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8')).users as any[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-stable-id-'));
    settingsPath = path.join(tmpDir, 'mcp_settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ mcpServers: {}, users: [] }), 'utf8');
    originalSettingsEnv = process.env.MCPHUB_SETTING_PATH;
    process.env.MCPHUB_SETTING_PATH = settingsPath;
    clearSettingsCache();
    dao = new UserDaoImpl();
  });

  afterEach(() => {
    if (originalSettingsEnv === undefined) delete process.env.MCPHUB_SETTING_PATH;
    else process.env.MCPHUB_SETTING_PATH = originalSettingsEnv;
    clearSettingsCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('assigns a random UUID at creation', async () => {
    await dao.createWithHashedPassword('alice', 'pw');
    const id = await resolveStableUserId('alice');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stored()[0].stableId).toBe(id);
  });

  it('is unchanged by password, group, admin or email changes', async () => {
    await dao.createWithHashedPassword('alice', 'pw');
    const id = await resolveStableUserId('alice');
    await dao.updatePassword('alice', 'other');
    await dao.update('alice', { isAdmin: true, email: 'a@example.test', userGroups: ['g'] });
    expect(await resolveStableUserId('alice')).toBe(id);
  });

  it('cannot be replaced through an update', async () => {
    await dao.createWithHashedPassword('alice', 'pw');
    const id = await resolveStableUserId('alice');
    await dao.update('alice', { stableId: 'attacker-chosen' });
    expect(await resolveStableUserId('alice')).toBe(id);
  });

  it('backfills an account that predates the id, once', async () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ mcpServers: {}, users: [{ username: 'old', password: 'x' }] }),
      'utf8',
    );
    clearSettingsCache();
    const [a, b] = await Promise.all([resolveStableUserId('old'), resolveStableUserId('old')]);
    expect(a).toBeTruthy();
    expect(stored()[0].stableId).toBe(await resolveStableUserId('old'));
    expect(await resolveStableUserId('old')).toBe(stored()[0].stableId);
    expect(b).toBeTruthy();
  });

  it('differs for a new account that reuses a deleted username', async () => {
    await dao.createWithHashedPassword('alice', 'pw');
    const first = await resolveStableUserId('alice');
    await dao.delete('alice');
    expect(await resolveStableUserId('alice')).toBeUndefined();
    await dao.createWithHashedPassword('alice', 'pw');
    const second = await resolveStableUserId('alice');
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('prefers the database primary key when the DAO provides one', async () => {
    dao = { findByUsername: async () => ({ id: 'db-uuid', username: 'u' }) } as any;
    expect(await resolveStableUserId('u')).toBe('db-uuid');
  });
});
