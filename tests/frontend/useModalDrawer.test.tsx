/**
 * @jest-environment jsdom
 */
import { createElement, useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useModalDrawer } from '../../frontend/src/hooks/useModalDrawer';

const Harness = ({ initiallyOpen = false, withMenu = false }: { initiallyOpen?: boolean; withMenu?: boolean }) => {
  const [open, setOpen] = useState(initiallyOpen);
  const [menu, setMenu] = useState(withMenu);
  const [dialog, setDialog] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useModalDrawer({ open, onClose: () => setOpen(false), containerRef: ref });
  return createElement(
    'div',
    null,
    createElement('button', { 'aria-controls': 'drawer', onClick: () => setOpen((v) => !v) }, 'menu'),
    createElement(
      'aside',
      { id: 'drawer', ref },
      createElement('a', { href: '/a' }, 'first'),
      createElement('a', { href: '/b', 'aria-current': 'page' }, 'current'),
      createElement('button', { onClick: () => setDialog(true) }, 'open-dialog'),
      createElement('button', { onClick: () => setOpen(false) }, 'last'),
      menu ? createElement('div', { 'data-layer': 'menu' }, 'menu-layer') : null,
    ),
    createElement('button', { onClick: () => setMenu(false) }, 'close-menu'),
    dialog
      ? createElement('div', { role: 'dialog', 'aria-modal': 'true' }, createElement('button', null, 'in-dialog'), createElement('button', { onClick: () => setDialog(false) }, 'close-dialog'))
      : null,
    createElement('span', { 'data-testid': 'state' }, open ? 'open' : 'closed'),
  );
};

const state = () => screen.getByTestId('state').textContent;
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });

beforeEach(() => {
  document.body.style.overflow = '';
});

describe('useModalDrawer', () => {
  it('moves focus to the current page link on open and locks scroll', () => {
    render(createElement(Harness, { initiallyOpen: true }));
    expect(document.activeElement).toBe(screen.getByText('current'));
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes on Escape, unlocks scroll and returns focus to the menu button', () => {
    render(createElement(Harness, { initiallyOpen: true }));
    press('Escape');
    expect(state()).toBe('closed');
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(screen.getByText('menu'));
  });

  it('returns focus to the menu button after a backdrop-style close with focus on body', () => {
    render(createElement(Harness, { initiallyOpen: true }));
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByText('menu'));
    expect(state()).toBe('closed');
    expect(document.activeElement).toBe(screen.getByText('menu'));
  });

  it('returns focus to the menu button when a link inside closes it', () => {
    render(createElement(Harness, { initiallyOpen: true }));
    screen.getByText('first').focus();
    fireEvent.click(screen.getByText('last'));
    expect(document.activeElement).toBe(screen.getByText('menu'));
  });

  it('leaves Escape to an open menu layer, then closes on the next one', () => {
    render(createElement(Harness, { initiallyOpen: true, withMenu: true }));
    press('Escape');
    expect(state()).toBe('open');
    fireEvent.click(screen.getByText('close-menu'));
    press('Escape');
    expect(state()).toBe('closed');
  });

  it('leaves Escape and Tab to a modal dialog portaled outside the drawer', () => {
    render(createElement(Harness, { initiallyOpen: true }));
    fireEvent.click(screen.getByText('open-dialog'));
    screen.getByText('in-dialog').focus();
    press('Escape');
    expect(state()).toBe('open');
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(screen.getByText('in-dialog'));
  });

  it('does not steal focus from a dialog opened as the drawer closes', () => {
    render(createElement(Harness, { initiallyOpen: true }));
    fireEvent.click(screen.getByText('open-dialog'));
    screen.getByText('in-dialog').focus();
    act(() => {
      fireEvent.click(screen.getByText('last'));
    });
    expect(state()).toBe('closed');
    expect(document.activeElement).toBe(screen.getByText('in-dialog'));
  });

  it('keeps Tab inside the drawer and wraps in both directions', () => {
    render(createElement(Harness, { initiallyOpen: true }));
    const last = screen.getByText('last');
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByText('first'));

    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    screen.getByText('first').dispatchEvent(back);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('pulls focus back in when Tab starts outside the drawer', () => {
    render(createElement(Harness, { initiallyOpen: true }));
    screen.getByText('menu').focus();
    press('Tab');
    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('restores scroll and the Escape listener on unmount', () => {
    const { unmount } = render(createElement(Harness, { initiallyOpen: true }));
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('unlocks scroll when the open flag drops, as it does when the viewport widens', () => {
    const Resizable = ({ open }: { open: boolean }) => {
      const ref = useRef<HTMLElement>(null);
      useModalDrawer({ open, onClose: () => undefined, containerRef: ref });
      return createElement('aside', { ref }, createElement('a', { href: '/' }, 'x'));
    };
    const { rerender } = render(createElement(Resizable, { open: true }));
    expect(document.body.style.overflow).toBe('hidden');
    rerender(createElement(Resizable, { open: false }));
    expect(document.body.style.overflow).toBe('');
  });
});
