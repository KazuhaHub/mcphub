import React, { useEffect, useState } from 'react';
import { loadServerIcon, serverInitial } from '@/utils/serverIcon';

interface ServerIconProps {
  name: string;
  /** The icon's URL from the API, or a data: URL for a preview; absent shows a letter tile. */
  icon?: string;
  size?: number;
  className?: string;
}

/**
 * A server's icon on a plate, or a letter tile (first letter of the name) when it has none or
 * it cannot be loaded. The plate is white in both themes, like the client tiles, so a dark mark
 * or a transparent PNG stays legible. The image is shown only through <img>, so scripts in an
 * SVG never run.
 */
const ServerIcon: React.FC<ServerIconProps> = ({ name, icon, size = 28, className }) => {
  const [src, setSrc] = useState<string | null>(icon?.startsWith('data:') ? icon : null);

  useEffect(() => {
    if (!icon) {
      setSrc(null);
      return;
    }
    if (icon.startsWith('data:')) {
      setSrc(icon);
      return;
    }
    let live = true;
    setSrc(null);
    void loadServerIcon(icon).then((loaded) => {
      if (live) setSrc(loaded);
    });
    return () => {
      live = false;
    };
  }, [icon]);

  const letter = serverInitial(name);
  return (
    <span
      aria-hidden
      data-testid="server-icon"
      data-icon={src ? 'image' : 'letter'}
      className={'inline-flex shrink-0 items-center justify-center overflow-hidden ' + (className ?? '')}
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--hub-radius-lg)',
        background: '#ffffff',
        border: '1px solid var(--hub-line)',
        color: '#57606a',
        fontWeight: 700,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          onError={() => setSrc(null)}
          style={{ width: '82%', height: '82%', objectFit: 'contain' }}
        />
      ) : (
        letter
      )}
    </span>
  );
};

export default ServerIcon;
