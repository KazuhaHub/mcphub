import { ChangelogEntry, ChangelogUpdateInfo } from '../types/index.js';
import { logger } from '../utils/logger.js';

// Releases of this fork are published as GitHub Releases, not to npm.
const DEFAULT_UPDATE_REPO = 'KazuhaHub/mcphub';
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_WEB_BASE = 'https://github.com';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CACHE_TTL_SECONDS = 21600;
const MAX_HIGHLIGHTS = 5;

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string | null;
  html_url?: string;
  published_at?: string | null;
  body?: string | null;
}

interface CachedUpdateInfo {
  key: string;
  expiresAt: number;
  data: ChangelogUpdateInfo;
}

let cachedUpdateInfo: CachedUpdateInfo | null = null;

export function clearChangelogUpdateCache(): void {
  cachedUpdateInfo = null;
}

export async function getChangelogUpdateInfo(input: {
  currentVersion: string;
  locale?: string;
  force?: boolean;
}): Promise<ChangelogUpdateInfo> {
  const locale = normalizeLocale(input.locale);
  const currentVersion = input.currentVersion || 'dev';
  const allChangelogUrl = releasesPageUrl();

  if (process.env.DISABLE_UPDATE_CHECK === 'true') {
    return {
      latestVersion: null,
      hasUpdate: false,
      entries: [],
      totalUpdateCount: 0,
      changelogUrl: allChangelogUrl,
      allChangelogUrl,
      source: 'disabled',
    };
  }

  const cacheKey = `${currentVersion}:${locale}`;
  const now = Date.now();
  if (!input.force && cachedUpdateInfo?.key === cacheKey && cachedUpdateInfo.expiresAt > now) {
    return cachedUpdateInfo.data;
  }

  const apiBase = changelogApiBase();
  const data = apiBase
    ? await fetchUpdateInfoFromMcphubWeb(apiBase, currentVersion, locale).catch((error) => {
        logger.warn('[changelog] changelog API update check failed, falling back to GitHub', {
          error: error instanceof Error ? error.message : String(error),
        });
        return fetchLatestGitHubRelease(currentVersion, locale);
      })
    : await fetchLatestGitHubRelease(currentVersion, locale);

  cachedUpdateInfo = {
    key: cacheKey,
    expiresAt: now + cacheTtlMs(),
    data,
  };

  return data;
}

// Opt-in: a service speaking the mcphub-web changelog API, set via
// MCPHUB_CHANGELOG_API_BASE. Unset by default.
async function fetchUpdateInfoFromMcphubWeb(
  apiBase: string,
  currentVersion: string,
  locale: 'en' | 'zh',
): Promise<ChangelogUpdateInfo> {
  const url = new URL(`${apiBase}/update-info`);
  url.searchParams.set('currentVersion', currentVersion);
  url.searchParams.set('locale', locale);

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs()),
  });
  const envelope = (await response
    .json()
    .catch(() => null)) as ApiEnvelope<ChangelogUpdateInfo> | null;

  if (!response.ok || !envelope?.success || !envelope.data) {
    throw new Error(envelope?.message || `Changelog request failed: ${response.status}`);
  }

  return envelope.data;
}

async function fetchLatestGitHubRelease(
  currentVersion: string,
  locale: 'en' | 'zh',
): Promise<ChangelogUpdateInfo> {
  const allChangelogUrl = releasesPageUrl();
  const response = await fetch(`${GITHUB_API_BASE}/repos/${updateRepo()}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'mcphub-update-check',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!response.ok) {
    throw new Error(`GitHub latest release request failed: ${response.status}`);
  }

  const release = (await response.json().catch(() => ({}))) as GitHubRelease;
  const latestVersion = release.tag_name ? release.tag_name.replace(/^v/i, '') : null;
  const hasUpdate =
    latestVersion !== null &&
    currentVersion !== 'dev' &&
    compareStableVersions(latestVersion, currentVersion) > 0;
  const releaseUrl = release.html_url || allChangelogUrl;

  return {
    latestVersion,
    hasUpdate,
    entries:
      hasUpdate && latestVersion
        ? [toChangelogEntry(release, latestVersion, releaseUrl, locale)]
        : [],
    totalUpdateCount: hasUpdate ? 1 : 0,
    changelogUrl: hasUpdate ? releaseUrl : allChangelogUrl,
    allChangelogUrl,
    source: 'github-release',
  };
}

function toChangelogEntry(
  release: GitHubRelease,
  version: string,
  releaseUrl: string,
  locale: 'en' | 'zh',
): ChangelogEntry {
  const body = (release.body || '').replace(/\r\n?/g, '\n');
  const localized = localizedSection(body, locale);
  return {
    product: 'mcphub',
    version,
    tagName: release.tag_name || `v${version}`,
    publishedAt: release.published_at || '',
    url: releaseUrl,
    changelogUrl: releaseUrl,
    title: release.name || `v${version}`,
    summary: firstParagraph(localized),
    highlights: bulletHighlights(localized),
    fixes: [],
    breakingChanges: [],
    upgradeNotes: [],
    categories: [],
    locale,
    bodyMarkdown: body,
    isStructured: false,
  };
}

// Release notes are bilingual: the English half comes first and the Chinese
// half starts at the "## 摘要" heading.
function localizedSection(body: string, locale: 'en' | 'zh'): string {
  const zhStart = body.search(/^##\s*摘要\s*$/m);
  if (zhStart < 0) return body;
  return locale === 'zh' ? body.slice(zhStart) : body.slice(0, zhStart);
}

function firstParagraph(markdown: string): string {
  // Drop heading lines so a heading followed directly by text still yields that text.
  const paragraphs = markdown.split(/\n\s*\n/).map((block) => block.replace(/^#.*$/gm, '').trim());
  const paragraph = paragraphs.find((block) => block && !/^[-*]\s/.test(block));
  return paragraph ? paragraph.replace(/\s*\n\s*/g, ' ') : '';
}

function bulletHighlights(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => line.match(/^\s*[-*]\s+(.*)$/)?.[1]?.trim())
    .filter((item): item is string => Boolean(item))
    .map((item) => {
      const bold = item.match(/^\*\*(.+?)\*\*/);
      const text = bold ? bold[1] : item.replace(/\s+by @\S+ in https?:\/\/\S+$/i, '');
      return text.replace(/[\s:：.。]+$/, '');
    })
    .filter(Boolean)
    .slice(0, MAX_HIGHLIGHTS);
}

function normalizeLocale(value: string | undefined): 'en' | 'zh' {
  return value?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function updateRepo(): string {
  const repo = process.env.MCPHUB_UPDATE_REPO?.trim().replace(/^\/+|\/+$/g, '');
  return repo && /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : DEFAULT_UPDATE_REPO;
}

function releasesPageUrl(): string {
  return `${GITHUB_WEB_BASE}/${updateRepo()}/releases`;
}

function changelogApiBase(): string | null {
  const value = process.env.MCPHUB_CHANGELOG_API_BASE?.trim();
  return value ? value.replace(/\/+$/, '') : null;
}

function timeoutMs(): number {
  const value = Number(process.env.MCPHUB_UPDATE_CHECK_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_TIMEOUT_MS;
}

function cacheTtlMs(): number {
  const raw = process.env.MCPHUB_UPDATE_CHECK_CACHE_TTL_SECONDS;
  const value = raw?.trim() ? Number(raw) : NaN;
  const seconds =
    Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_CACHE_TTL_SECONDS;
  return seconds * 1000;
}

function parseStableVersion(version: string): [number, number, number] | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareStableVersions(a: string, b: string): number {
  const parsedA = parseStableVersion(a);
  const parsedB = parseStableVersion(b);
  if (!parsedA || !parsedB) return 0;
  for (let i = 0; i < 3; i++) {
    if (parsedA[i] > parsedB[i]) return 1;
    if (parsedA[i] < parsedB[i]) return -1;
  }
  return 0;
}
