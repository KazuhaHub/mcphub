import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Layer {
  id: symbol;
  element: () => HTMLElement | null;
}

// Open dialogs and panels, bottom to top. Only the top one reacts to Escape and Tab.
const layers: Layer[] = [];
let scrollLocks = 0;
let savedOverflow = '';

const lockScroll = () => {
  if (scrollLocks++ === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
};
const unlockScroll = () => {
  if (--scrollLocks === 0) document.body.style.overflow = savedOverflow;
};

/** Number of layers currently open; exposed for tests. */
export const openModalLayers = (): number => layers.length;

interface Options {
  onClose: () => void;
  /** Where focus goes on close when the element that had focus on open is gone. */
  fallbackFocus?: () => HTMLElement | null;
  /** Skip moving focus to the container on open (the caller focuses something inside). */
  skipInitialFocus?: boolean;
}

/**
 * Behaviour shared by the hand-rolled dialogs and the service panel: focus moves in on open and
 * is kept inside with Tab, page scroll is locked, Escape closes only the topmost layer, and on
 * close focus returns to the opener, or to a fallback (the layer underneath, then
 * `fallbackFocus`) when the opener no longer exists.
 */
export const useModalLayer = (
  containerRef: React.RefObject<HTMLElement | null>,
  { onClose, fallbackFocus, skipInitialFocus }: Options,
): void => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const fallbackRef = useRef(fallbackFocus);
  fallbackRef.current = fallbackFocus;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer: Layer = { id: Symbol('modal-layer'), element: () => containerRef.current };
    layers.push(layer);
    lockScroll();
    if (!skipInitialFocus) containerRef.current?.focus({ preventScroll: true });

    const isTop = () => layers[layers.length - 1]?.id === layer.id;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (
        event.shiftKey &&
        (active === first || active === container || !container.contains(active))
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const index = layers.findIndex((entry) => entry.id === layer.id);
      if (index >= 0) layers.splice(index, 1);
      unlockScroll();
      const target =
        opener && opener.isConnected
          ? opener
          : (layers[layers.length - 1]?.element() ?? fallbackRef.current?.() ?? null);
      target?.focus();
    };
    // Registered once per mount; the options are read through refs.
  }, []);
};
