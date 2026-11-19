import React, { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import Content from '@/components/layout/Content';
import { EmbeddingSyncProvider } from '@/contexts/EmbeddingSyncContext';
import { initialSidebarState, sidebarReducer } from '@/utils/sidebarState';

const PageFallback: React.FC = () => (
  <div
    className="flex h-full min-h-[240px] items-center justify-center text-sm"
    style={{ color: 'var(--hub-ink-3)' }}
  >
    Loading...
  </div>
);

// Below this width (Tailwind's md breakpoint) the sidebar becomes an off-canvas drawer.
const NARROW_QUERY = '(max-width: 767px)';

const isNarrow = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(NARROW_QUERY).matches
    : false;

// Reports the current narrow state, then every crossing; returns the unsubscribe.
export const followNarrowViewport = (onChange: (narrow: boolean) => void): (() => void) => {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(NARROW_QUERY);
  // The width may have crossed between the first render and this subscription.
  onChange(query.matches);
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};

const MainLayout: React.FC = () => {
  const [sidebar, dispatch] = React.useReducer(sidebarReducer, undefined, () =>
    initialSidebarState(isNarrow()),
  );
  const { pathname } = useLocation();

  // Follow the viewport: a drawer on phones, the expanded rail when the window widens again.
  // The menu button still overrides this until the next crossing.
  React.useEffect(() => followNarrowViewport((narrow) => dispatch({ type: 'viewport', narrow })), []);

  // Navigating closes the drawer.
  React.useEffect(() => {
    dispatch({ type: 'close' });
  }, [pathname]);

  const toggleSidebar = () => dispatch({ type: 'toggle' });
  const closeSidebar = React.useCallback(() => dispatch({ type: 'close' }), []);

  return (
    <EmbeddingSyncProvider>
      <div className="flex h-screen supports-[height:100dvh]:h-dvh" style={{ background: 'var(--hub-bg)', color: 'var(--hub-ink)' }}>
        {sidebar.narrow && (
          <div
            aria-hidden="true"
            data-testid="sidebar-backdrop"
            onClick={closeSidebar}
            className={
              'fixed inset-0 z-30 bg-black/40 transition-opacity duration-200 ' +
              (sidebar.drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0')
            }
          />
        )}
        <Sidebar
          collapsed={sidebar.collapsed}
          drawer={sidebar.narrow}
          open={sidebar.drawerOpen}
          onClose={closeSidebar}
        />
        <div className="flex flex-1 flex-col min-w-0 min-h-0">
          <Header onToggleSidebar={toggleSidebar} menuExpanded={sidebar.narrow ? sidebar.drawerOpen : !sidebar.collapsed} />
          <Content>
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </Content>
        </div>
      </div>
    </EmbeddingSyncProvider>
  );
};

export default MainLayout;
