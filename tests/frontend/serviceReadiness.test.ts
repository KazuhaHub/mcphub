import fs from 'node:fs';
import path from 'node:path';
import {
  buildReadinessConfig,
  formatReadinessDate,
  getReadinessProblem,
  getSafeActionHref,
  readinessToForm,
  readinessExpiryNote,
  readinessPrimaryAction,
  readinessTone,
  shouldShowReadinessChip,
} from '../../frontend/src/utils/readiness';
import type { WorkspaceReadiness } from '../../frontend/src/types';

const readiness = (extra: Partial<WorkspaceReadiness> = {}): WorkspaceReadiness => ({
  state: 'needs_setup',
  summary: null,
  action: null,
  expiresAt: null,
  checkedAt: '2026-11-19T10:00:00.000Z',
  ...extra,
});

describe('readinessTone', () => {
  it.each([
    ['ready', 'ok'],
    ['needs_setup', 'warn'],
    ['degraded', 'warn'],
    ['expiring', 'warn'],
    ['unknown', 'warn'],
    ['expired', 'err'],
    ['revoked', 'err'],
  ] as const)('%s is %s', (state, tone) => {
    expect(readinessTone(state)).toBe(tone);
  });
});

describe('getSafeActionHref', () => {
  it('accepts https links only', () => {
    expect(getSafeActionHref('https://canvas.example.com/setup')).toBe(
      'https://canvas.example.com/setup',
    );
    for (const bad of [
      'http://canvas.example.com',
      'javascript:alert(1)',
      'data:text/html,x',
      '/relative',
      'https://user:pw@canvas.example.com',
      '',
      undefined,
    ]) {
      expect(getSafeActionHref(bad)).toBeUndefined();
    }
  });
});

describe('readinessPrimaryAction', () => {
  const action = { label: 'Set up', url: 'https://canvas.example.com/setup' };

  it('is the service action when the state is not ready', () => {
    expect(readinessPrimaryAction(readiness({ action }))).toEqual(action);
  });

  it('is absent when ready, without an action, or with an unsafe link', () => {
    expect(readinessPrimaryAction(readiness({ state: 'ready', action }))).toBeUndefined();
    expect(readinessPrimaryAction(readiness())).toBeUndefined();
    expect(readinessPrimaryAction(null)).toBeUndefined();
    expect(
      readinessPrimaryAction(readiness({ action: { label: 'x', url: 'javascript:alert(1)' } })),
    ).toBeUndefined();
  });
});

describe('readinessExpiryNote', () => {
  const now = Date.parse('2026-11-19T10:00:00Z');

  it('says when a setup expires and when it expired', () => {
    expect(
      readinessExpiryNote(
        readiness({ state: 'expiring', expiresAt: '2026-12-01T00:00:00.000Z' }),
        now,
      ),
    ).toEqual({ kind: 'expires', date: '2026-12-01T00:00:00.000Z' });
    expect(
      readinessExpiryNote(
        readiness({ state: 'expired', expiresAt: '2026-11-01T00:00:00.000Z' }),
        now,
      ),
    ).toEqual({ kind: 'expired', date: '2026-11-01T00:00:00.000Z' });
  });

  it('says nothing without a date or for a lapsed date on a live state', () => {
    expect(readinessExpiryNote(readiness({ state: 'expiring' }), now)).toBeNull();
    expect(readinessExpiryNote(readiness({ state: 'expired' }), now)).toBeNull();
    expect(
      readinessExpiryNote(
        readiness({ state: 'ready', expiresAt: '2026-11-01T00:00:00.000Z' }),
        now,
      ),
    ).toBeNull();
    expect(readinessExpiryNote(null, now)).toBeNull();
  });

  it('mentions a future expiry of a ready or degraded setup', () => {
    expect(
      readinessExpiryNote(
        readiness({ state: 'ready', expiresAt: '2027-01-01T00:00:00.000Z' }),
        now,
      ),
    ).toEqual({ kind: 'expires', date: '2027-01-01T00:00:00.000Z' });
  });
});

describe('shouldShowReadinessChip', () => {
  it('replaces only the ready chip: a more important state wins', () => {
    expect(shouldShowReadinessChip(readiness(), 'ready')).toBe(true);
    expect(shouldShowReadinessChip(readiness(), 'needs_signin')).toBe(false);
    expect(shouldShowReadinessChip(readiness(), 'unavailable')).toBe(false);
    expect(shouldShowReadinessChip(null, 'ready')).toBe(false);
    expect(shouldShowReadinessChip(undefined, 'ready')).toBe(false);
  });
});

describe('the admin readiness setting', () => {
  it('builds the config from the form, or null to clear it', () => {
    expect(buildReadinessConfig(' https://svc.example.com/ready ', 'oauth')).toEqual({
      url: 'https://svc.example.com/ready',
      auth: 'oauth',
    });
    expect(buildReadinessConfig('https://svc.example.com/ready', 'credential:UBC_TOKEN')).toEqual({
      url: 'https://svc.example.com/ready',
      auth: { credential: 'UBC_TOKEN' },
    });
    expect(buildReadinessConfig('', 'oauth')).toBeNull();
    expect(buildReadinessConfig('   ', undefined)).toBeNull();
    expect(buildReadinessConfig(undefined, undefined)).toBeNull();
  });

  it('round trips the stored value into the form', () => {
    expect(readinessToForm(undefined)).toEqual({ readinessUrl: '', readinessAuth: 'oauth' });
    expect(readinessToForm({ url: 'https://s.example.com/r', auth: 'oauth' })).toEqual({
      readinessUrl: 'https://s.example.com/r',
      readinessAuth: 'oauth',
    });
    expect(
      readinessToForm({ url: 'https://s.example.com/r', auth: { credential: 'TOKEN' } }),
    ).toEqual({ readinessUrl: 'https://s.example.com/r', readinessAuth: 'credential:TOKEN' });
  });

  it('reports what is wrong, only for administrators', () => {
    const slots = ['TOKEN'];
    expect(getReadinessProblem('', 'oauth', slots, true)).toBeNull();
    expect(getReadinessProblem('https://s.example.com/r', 'oauth', slots, true)).toBeNull();
    expect(
      getReadinessProblem('https://s.example.com/r', 'credential:TOKEN', slots, true),
    ).toBeNull();
    expect(getReadinessProblem('http://s.example.com/r', 'oauth', slots, true)).toBe('scheme');
    expect(getReadinessProblem('http://localhost/r', 'oauth', slots, true)).toBe('scheme');
    expect(getReadinessProblem('nope', 'oauth', slots, true)).toBe('invalid');
    expect(getReadinessProblem('https://u:p@s.example.com/r', 'oauth', slots, true)).toBe(
      'credentials',
    );
    expect(
      getReadinessProblem('https://s.example.com/' + 'a'.repeat(2048), 'oauth', slots, true),
    ).toBe('tooLong');
    expect(getReadinessProblem('https://s.example.com/r', 'credential:OTHER', slots, true)).toBe(
      'slotMissing',
    );
    expect(getReadinessProblem('https://s.example.com/r', '', slots, true)).toBe('authRequired');
    expect(getReadinessProblem('http://s.example.com/r', 'oauth', slots, false)).toBeNull();
  });
});

describe('formatReadinessDate', () => {
  const value = '2026-11-23T00:45:03.000Z';

  it('shows date plus hours and minutes, never seconds, in the UI language', () => {
    const en = formatReadinessDate(value, 'en', 'America/Los_Angeles');
    expect(en).toContain('2026');
    expect(en).toMatch(/4:45\s?PM/);
    expect(en).not.toMatch(/:03/);
    const zh = formatReadinessDate(value, 'zh', 'Asia/Shanghai');
    expect(zh).toContain('2026');
    expect(zh).toMatch(/8:45/);
    expect(zh).not.toMatch(/:03/);
    expect(en).not.toBe(zh);
  });

  it('returns the raw text for something that is not a date', () => {
    expect(formatReadinessDate('soon', 'en')).toBe('soon');
  });
});

describe('readiness wording in every locale', () => {
  const dir = path.resolve(__dirname, '../../locales');
  const locales = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
  const load = (file: string) =>
    JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).workspacePage.readiness;

  it('calls a revoked state "Access revoked", not "Sign in again", in English and Chinese', () => {
    expect(load('en.json').state.revoked).toBe('Access revoked');
    expect(load('zh.json').state.revoked).toBe('访问已撤销');
  });

  it.each(locales)('%s: the chip no longer says to sign in, the fallback text does', (file) => {
    const readiness = load(file);
    expect(readiness.state.revoked).not.toMatch(/sign in again|reconnect/i);
    expect(readiness.text.revoked.length).toBeGreaterThan(readiness.state.revoked.length);
  });

  it('the English fallback tells the user to sign in again or reconnect', () => {
    expect(load('en.json').text.revoked).toMatch(/sign in again or reconnect/i);
  });
});
