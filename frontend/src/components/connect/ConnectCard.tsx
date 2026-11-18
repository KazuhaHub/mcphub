import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug } from 'lucide-react';
import { EndpointCopy } from '@/components/ui/EndpointCopy';
import { useSettings } from '@/contexts/SettingsContext';
import { fetchWorkspaceEndpoints, fetchWorkspaceServers } from '@/services/workspaceService';
import type { WorkspaceEndpoints, WorkspaceServer } from '@/types';
import {
  CONNECT_CLIENTS,
  computeTileLayout,
  type ConnectClientId,
  type TileLayout,
} from '@/utils/connectClients';
import { getSmartRoutingPath } from '@/utils/runtime';
import { buildSmartEndpoint } from '@/utils/workspace';
import ConnectDialog, { type ConnectDialogInitial } from './ConnectDialog';
import ConnectTile from './ConnectTile';

// Tile width floor and gap in px. 76 lets a 375px phone show three clients beside More.
const MIN_TILE_WIDTH = 76;
const TILE_GAP = 8;

interface ConnectTilesProps {
  layout: TileLayout;
  onSelectClient: (id: ConnectClientId) => void;
  onMore: (hiddenIds: ConnectClientId[]) => void;
}

/** The tile row: `layout.visible` equal client tiles, then always the More tile. */
export const ConnectTiles = React.forwardRef<HTMLDivElement, ConnectTilesProps>(
  ({ layout, onSelectClient, onMore }, ref) => {
    const { t } = useTranslation();
    const shown = CONNECT_CLIENTS.slice(0, layout.visible);
    const hidden = CONNECT_CLIENTS.slice(layout.visible);
    return (
      <div
        ref={ref}
        className="grid"
        style={{
          gap: TILE_GAP,
          gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
        }}
        data-testid="connect-tiles"
      >
        {shown.map((client) => (
          <ConnectTile key={client.id} client={client} onSelect={() => onSelectClient(client.id)} />
        ))}
        <ConnectTile
          more
          label={t('connect.more')}
          ariaHaspopup
          onSelect={() => onMore(hidden.map((client) => client.id))}
        />
      </div>
    );
  },
);
ConnectTiles.displayName = 'ConnectTiles';

const ConnectCard: React.FC = () => {
  const { t } = useTranslation();
  const { smartRoutingConfig } = useSettings();
  const [servers, setServers] = useState<WorkspaceServer[]>([]);
  const [endpoints, setEndpoints] = useState<WorkspaceEndpoints | null>(null);
  const [failed, setFailed] = useState(false);
  const [smart, setSmart] = useState(false);
  const [dialog, setDialog] = useState<{ nonce: number; initial: ConnectDialogInitial } | null>(
    null,
  );
  const [width, setWidth] = useState(0);
  const tilesRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [nextServers, nextEndpoints] = await Promise.all([
        fetchWorkspaceServers(),
        fetchWorkspaceEndpoints(),
      ]);
      setServers(nextServers);
      setEndpoints(nextEndpoints);
      setFailed(false);
    } catch {
      // The services tab reports a failing or disabled workspace; the card just stays away.
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Measure the container itself rather than assuming breakpoints: the sidebar, the page
  // padding and the viewport all change how much room the row has.
  useLayoutEffect(() => {
    const node = tilesRef.current;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (typeof next === 'number') setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [endpoints]);

  const layout = useMemo(
    () => computeTileLayout(width, CONNECT_CLIENTS.length, MIN_TILE_WIDTH, TILE_GAP),
    [width],
  );

  if (failed || !endpoints) return null;

  const smartUrl = buildSmartEndpoint(endpoints.aggregate, getSmartRoutingPath());
  const activeUrl = smart ? smartUrl : endpoints.aggregate;
  const open = (initial: ConnectDialogInitial) => {
    // Selection may have changed on the services tab since this card loaded.
    void load();
    setDialog({ nonce: Date.now(), initial });
  };

  return (
    <section className="hub-card space-y-4 p-4" aria-labelledby="connect-ai-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id="connect-ai-title" className="hub-card-title">
            {t('connect.title')}
          </h2>
          <p className="hub-sub mt-1">{t('connect.subtitle')}</p>
        </div>
        <button
          type="button"
          className="hub-btn"
          onClick={() => open({ pickService: true })}
          data-testid="connect-single-service"
        >
          <Plug size={13} /> {t('connect.singleService')}
        </button>
      </div>

      <ConnectTiles
        ref={tilesRef}
        layout={layout}
        onSelectClient={(id) => open({ service: null, client: id })}
        onMore={(hiddenIds) => open({ service: null, clientChoices: hiddenIds })}
      />

      <div className="space-y-2">
        <EndpointCopy
          url={activeUrl}
          label={t('connect.endpoint')}
          ariaLabel={t('connect.endpoint')}
        />
        {smartRoutingConfig.enabled && (
          <>
            <div className="hub-seg" role="group" aria-label={t('workspacePage.endpoint.mode')}>
              {(['direct', 'smart'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={smart === (value === 'smart')}
                  onClick={() => setSmart(value === 'smart')}
                >
                  {t(`workspacePage.endpoint.mode_${value}`)}
                </button>
              ))}
            </div>
            <p className="text-[12px] leading-[1.625]" style={{ color: 'var(--hub-ink-3)' }}>
              {t('workspacePage.endpoint.smartHint')}
            </p>
          </>
        )}
      </div>

      {dialog && (
        <ConnectDialog
          key={dialog.nonce}
          aggregateUrl={activeUrl}
          servers={servers}
          endpoints={endpoints}
          initial={dialog.initial}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
};

export default ConnectCard;
