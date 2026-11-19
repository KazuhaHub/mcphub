/**
 * @jest-environment jsdom
 */
import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useModalLayer } from '../../frontend/src/hooks/useModalLayer';

const Layer = () => {
  const ref = useRef<HTMLDivElement>(null);
  useModalLayer(ref, { onClose: jest.fn() });
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true">
      <div hidden>
        <button type="button">hidden-first</button>
      </div>
      <button type="button" disabled>
        disabled-first
      </button>
      <button type="button">first</button>
      <button type="button">last</button>
      <details>
        <summary>more</summary>
        <button type="button">inside-closed</button>
      </details>
    </div>
  );
};

const tab = (shift = false) => fireEvent.keyDown(document, { key: 'Tab', shiftKey: shift });

describe('the focus trap', () => {
  it('wraps over controls nobody can reach: hidden, disabled, or inside a closed details', () => {
    render(<Layer />);
    // The summary is the last reachable control; the button inside the closed details is not.
    screen.getByText('more').focus();
    tab();
    expect(document.activeElement).toBe(screen.getByText('first'));
    screen.getByText('first').focus();
    tab(true);
    expect(document.activeElement).toBe(screen.getByText('more'));
  });

  it('reaches the controls of a details once it is open', () => {
    render(<Layer />);
    screen.getByText('more').parentElement!.setAttribute('open', '');
    screen.getByText('inside-closed').focus();
    tab();
    expect(document.activeElement).toBe(screen.getByText('first'));
  });
});
