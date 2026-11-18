import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { ConnectClient } from '@/utils/connectClients';
import { ClientIcon } from './ClientIcon';

interface ConnectTileProps {
  client?: ConnectClient;
  /** Label for the More and Other tiles, which have no client. */
  label?: string;
  onSelect: () => void;
  /** Marks the tile that opens the overflow list. */
  more?: boolean;
  ariaHaspopup?: boolean;
}

/** One equal-sized tile: brand mark above its name. Every client uses the same one. */
const ConnectTile: React.FC<ConnectTileProps> = ({ client, label, onSelect, more, ariaHaspopup }) => {
  const text = client?.name ?? label ?? '';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-haspopup={ariaHaspopup ? 'dialog' : undefined}
      className="flex min-w-0 flex-col items-center gap-2 rounded-md px-0.5 py-3 transition-colors hover:bg-[var(--hub-surface-hover)]"
      style={{ border: '1px solid var(--hub-line)', background: 'var(--hub-surface)' }}
      data-testid={more ? 'connect-tile-more' : `connect-tile-${client?.id ?? 'other'}`}
    >
      {client ? (
        <ClientIcon icon={client.icon} letter={client.letter} />
      ) : (
        <span
          aria-hidden
          className="inline-flex shrink-0 items-center justify-center"
          style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--hub-radius-lg)',
            background: 'var(--hub-bg-2)',
            border: '1px solid var(--hub-line)',
            color: 'var(--hub-ink-2)',
          }}
        >
          <MoreHorizontal size={18} />
        </span>
      )}
      <span
        className="w-full text-center text-[12px] leading-tight"
        style={{ color: 'var(--hub-ink)', overflowWrap: 'anywhere' }}
      >
        {text}
      </span>
    </button>
  );
};

export default ConnectTile;
