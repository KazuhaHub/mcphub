import { useEffect, useState } from 'react';
import { apiGet } from '@/utils/fetchInterceptor';

// The version is served only to signed-in users (GET /api/version) and is never compiled into
// the bundle. Fetched once per page load and shared by every consumer.
let cached: string | null = null;
let inflight: Promise<string> | null = null;

const loadVersion = (): Promise<string> => {
  if (cached !== null) return Promise.resolve(cached);
  if (!inflight) {
    inflight = apiGet<{ success: boolean; data?: { version?: string } }>('/version')
      .then((res) => {
        cached = res.success && res.data?.version ? res.data.version : '';
        return cached;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
};

/** Test helper: forget the cached version. */
export const resetAppVersionCache = (): void => {
  cached = null;
  inflight = null;
};

/** The running MCPHub version, or '' until it has loaded (or if it could not be loaded). */
export const useAppVersion = (): string => {
  const [version, setVersion] = useState<string>(cached ?? '');

  useEffect(() => {
    let active = true;
    loadVersion()
      .then((v) => active && setVersion(v))
      .catch(() => active && setVersion(''));
    return () => {
      active = false;
    };
  }, []);

  return version;
};
