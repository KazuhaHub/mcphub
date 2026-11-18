import {
  clearChangelogUpdateCache,
  getChangelogUpdateInfo,
} from '../../src/services/changelogService.js';

const RELEASE_BODY = `## Summary

v1.0.12 fixes a blank page on nested routes.
It also tidies the consent page.

## Fixes

- **Nested routes load their scripts again.** Details here. By @someone in https://github.com/KazuhaHub/mcphub/pull/21
- plain fix line by @someone in https://github.com/KazuhaHub/mcphub/pull/22

## 摘要

v1.0.12 修复多级路径页面空白的问题。

## 修复

- **多级路径页面恢复正常：** 细节。by @someone in https://github.com/KazuhaHub/mcphub/pull/21
`;

const githubRelease = (tag: string, body = RELEASE_BODY) => ({
  ok: true,
  json: async () => ({
    tag_name: tag,
    name: tag,
    html_url: `https://github.com/KazuhaHub/mcphub/releases/tag/${tag}`,
    published_at: '2026-11-17T00:00:00Z',
    body,
  }),
});

describe('changelogService', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearChangelogUpdateCache();
    process.env = { ...originalEnv };
    delete process.env.MCPHUB_CHANGELOG_API_BASE;
    delete process.env.MCPHUB_UPDATE_REPO;
    delete process.env.DISABLE_UPDATE_CHECK;
    process.env.MCPHUB_UPDATE_CHECK_CACHE_TTL_SECONDS = '21600';
    global.fetch = jest.fn();
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it("checks the fork's latest GitHub release and caches by version and locale", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(githubRelease('v1.0.12'));

    const first = await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'en' });
    const second = await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'en' });

    expect(second).toBe(first);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toBe(
      'https://api.github.com/repos/KazuhaHub/mcphub/releases/latest',
    );
    expect(first).toMatchObject({
      latestVersion: '1.0.12',
      hasUpdate: true,
      totalUpdateCount: 1,
      changelogUrl: 'https://github.com/KazuhaHub/mcphub/releases/tag/v1.0.12',
      allChangelogUrl: 'https://github.com/KazuhaHub/mcphub/releases',
      source: 'github-release',
    });
    expect(first.entries).toHaveLength(1);
    expect(first.entries[0]).toMatchObject({
      version: '1.0.12',
      tagName: 'v1.0.12',
      title: 'v1.0.12',
      url: 'https://github.com/KazuhaHub/mcphub/releases/tag/v1.0.12',
      summary: 'v1.0.12 fixes a blank page on nested routes. It also tidies the consent page.',
      highlights: ['Nested routes load their scripts again', 'plain fix line'],
      locale: 'en',
    });
  });

  it('reports up to date with no entries when the current version is the latest', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(githubRelease('v2.3.1'));

    const result = await getChangelogUpdateInfo({ currentVersion: '2.3.1', locale: 'en' });

    expect(result).toEqual({
      latestVersion: '2.3.1',
      hasUpdate: false,
      entries: [],
      totalUpdateCount: 0,
      changelogUrl: 'https://github.com/KazuhaHub/mcphub/releases',
      allChangelogUrl: 'https://github.com/KazuhaHub/mcphub/releases',
      source: 'github-release',
    });
  });

  it('uses the Chinese half of the release notes for Chinese locales', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(githubRelease('v1.0.12'));

    const result = await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'zh-TW' });

    expect(result.entries[0]).toMatchObject({
      summary: 'v1.0.12 修复多级路径页面空白的问题。',
      highlights: ['多级路径页面恢复正常'],
      locale: 'zh',
    });
  });

  it('parses CRLF release notes and headings followed directly by text', async () => {
    const body = '## Summary\r\nShort summary.\r\n\r\n## Fixes\r\n\r\n- **Bold fix:** detail\r\n';
    (global.fetch as jest.Mock).mockResolvedValue(githubRelease('v1.0.12', body));

    const result = await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'en' });

    expect(result.entries[0]).toMatchObject({
      summary: 'Short summary.',
      highlights: ['Bold fix'],
    });
  });

  it('honors MCPHUB_UPDATE_REPO for the release source', async () => {
    process.env.MCPHUB_UPDATE_REPO = 'example/hub';
    (global.fetch as jest.Mock).mockResolvedValue(githubRelease('v1.0.0'));

    const result = await getChangelogUpdateInfo({ currentVersion: '1.0.0', locale: 'en' });

    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toBe(
      'https://api.github.com/repos/example/hub/releases/latest',
    );
    expect(result.allChangelogUrl).toBe('https://github.com/example/hub/releases');
  });

  it('never reports an update for dev builds', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(githubRelease('v9.9.9'));

    const result = await getChangelogUpdateInfo({ currentVersion: 'dev', locale: 'en' });

    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBe('9.9.9');
  });

  it('returns disabled payload when update checks are disabled', async () => {
    process.env.DISABLE_UPDATE_CHECK = 'true';

    const result = await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'zh-CN' });

    expect(result).toEqual({
      latestVersion: null,
      hasUpdate: false,
      entries: [],
      totalUpdateCount: 0,
      changelogUrl: 'https://github.com/KazuhaHub/mcphub/releases',
      allChangelogUrl: 'https://github.com/KazuhaHub/mcphub/releases',
      source: 'disabled',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses an explicitly configured changelog API first', async () => {
    process.env.MCPHUB_CHANGELOG_API_BASE = 'https://updates.example.com/api/v1/changelog/';
    const payload = {
      latestVersion: '1.0.12',
      hasUpdate: true,
      entries: [],
      totalUpdateCount: 1,
      changelogUrl: 'https://updates.example.com/changelog/1.0.12',
      allChangelogUrl: 'https://updates.example.com/changelog',
      source: 'mcphub-web',
    };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: payload }),
    });

    const result = await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'zh-TW' });

    expect(result).toEqual(payload);
    const url = String((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url).toContain('https://updates.example.com/api/v1/changelog/update-info');
    expect(url).toContain('currentVersion=1.0.11');
    expect(url).toContain('locale=zh');
  });

  it('falls back to GitHub when the configured changelog API fails', async () => {
    process.env.MCPHUB_CHANGELOG_API_BASE = 'https://updates.example.com/api/v1/changelog';
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ success: false, message: 'unavailable' }),
      })
      .mockResolvedValueOnce(githubRelease('v1.0.12'));

    const result = await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'en' });

    expect(result.source).toBe('github-release');
    expect(result.latestVersion).toBe('1.0.12');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('handles invalid GitHub JSON without throwing', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    const result = await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'en' });

    expect(result).toEqual({
      latestVersion: null,
      hasUpdate: false,
      entries: [],
      totalUpdateCount: 0,
      changelogUrl: 'https://github.com/KazuhaHub/mcphub/releases',
      allChangelogUrl: 'https://github.com/KazuhaHub/mcphub/releases',
      source: 'github-release',
    });
  });

  it('throws when the GitHub request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, json: async () => ({}) });

    await expect(
      getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'en' }),
    ).rejects.toThrow('GitHub latest release request failed');
  });

  it.each(['', '   '])('uses the default cache TTL when it is %j', async (ttl) => {
    process.env.MCPHUB_UPDATE_CHECK_CACHE_TTL_SECONDS = ttl;
    (global.fetch as jest.Mock).mockResolvedValue(githubRelease('v1.0.12'));

    await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'en' });
    await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'en' });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('still honors an explicit TTL of 0 (no caching)', async () => {
    process.env.MCPHUB_UPDATE_CHECK_CACHE_TTL_SECONDS = '0';
    (global.fetch as jest.Mock).mockResolvedValue(githubRelease('v1.0.12'));

    await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'en' });
    await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'en' });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
