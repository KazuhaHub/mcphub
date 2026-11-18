import { useEffect, useRef } from 'react';
import { trapTabTarget } from '@/utils/sidebarState';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalDrawerOptions {
  open: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
}

// While `open`: closes on Escape, locks page scroll, moves focus into the container, keeps Tab
// inside it, and hands focus back to whatever had it before the drawer opened.
export const useModalDrawer = ({ open, onClose, containerRef }: ModalDrawerOptions): void => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = () =>
      container ? Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];

    // Prefer the current page's link so keyboard users start where they are.
    const initial = container?.querySelector<HTMLElement>('[aria-current="page"]') ?? focusables()[0];
    initial?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      const target = trapTabTarget(
        items.length,
        items.indexOf(document.activeElement as HTMLElement),
        event.shiftKey,
      );
      if (target !== null) {
        event.preventDefault();
        items[target].focus();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      // Skip when focus already moved on (for example into the page after a navigation).
      if (opener && opener.isConnected && (container?.contains(document.activeElement) ?? true)) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [open, containerRef]);
};
