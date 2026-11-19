import { useEffect, useRef } from 'react';
import { trapTabTarget } from '@/utils/sidebarState';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalDrawerOptions {
  open: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
}

// Dialogs and menus that sit on top of the drawer. Portaled dialogs declare `aria-modal`; menus
// rendered inside the drawer carry `data-layer`. While one is open it owns Escape and Tab.
const outsideModal = (container: HTMLElement | null, el: Element | null): boolean => {
  const modal = el?.closest('[aria-modal="true"]');
  return !!modal && !container?.contains(modal);
};
const layerOpen = (container: HTMLElement | null): boolean =>
  !!container?.querySelector('[data-layer]') ||
  Array.from(document.querySelectorAll('[aria-modal="true"]')).some((m) => !container?.contains(m));

// While `open`: closes on Escape (only when it is the topmost layer), locks page scroll, moves
// focus into the container, keeps Tab inside it, and on close hands focus back to the control
// that opened it (found through `aria-controls` when the opener was not focusable).
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
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        // One Escape closes one layer: a dialog or menu above the drawer gets it first.
        if (layerOpen(container)) return;
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      // Focus is in a portaled dialog: that dialog manages its own focus.
      if (outsideModal(container, document.activeElement)) return;
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
      // Hand focus back to the menu button, unless it moved on to a dialog opened from here.
      const active = document.activeElement;
      const returning = active === document.body || !active || !!container?.contains(active);
      if (returning && !outsideModal(container, active)) {
        const target =
          opener && opener !== document.body && opener.isConnected
            ? opener
            : container?.id
              ? document.querySelector<HTMLElement>(`[aria-controls="${container.id}"]`)
              : null;
        target?.focus({ preventScroll: true });
      }
    };
  }, [open, containerRef]);
};
