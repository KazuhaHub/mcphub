import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet } from '@/utils/fetchInterceptor';

// The version is served only to administrators (GET /api/version) and is never compiled into
// the bundle. Fetched once per page load and shared by every consumer.
let cached: string | null = null;
let inflight: Promise<string> | null = null;

const loadVersion = (): Promise<string> => {
  if (cached !== null) return Promise.resolve(cached);
  if (!inflight) {
    inflight = apiGet<{ success: boolean; data?: { version?: string } }>('/version')
      .then((res) => {
        const version = res.success && res.data?.version ? res.data.version : '';
        // Only a real answer is kept; a failed call (network, 429, restart) is tried again later.
        if (version) cached = version;
        return version;
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

/**
 * The running MCPHub version, or '' until it has loaded (or if it could not be loaded).
 * Always '' for anyone but an administrator, and /api/version is not even requested for them.
 */
export const useAppVersion = (): string => {
  const { auth } = useAuth();
  const isAdmin = Boolean(auth.isAuthenticated && auth.user?.isAdmin);
  const [version, setVersion] = useState<string>(cached ?? '');

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      loadVersion()
        .catch(() => '')
        .then((v) => {
          if (!active) return;
          setVersion(v);
          // Retry a failed load a few times, waiting longer each time (5 s, 10 s, 20 s, 40 s).
          if (!v && attempt < 4) {
            timer = setTimeout(load, 5000 * 2 ** attempt);
            attempt += 1;
          }
        });
    };
    load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [isAdmin]);

  return isAdmin ? version : '';
};
