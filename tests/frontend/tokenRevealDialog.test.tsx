/**
 * @jest-environment jsdom
 */
import '../utils/textEncoderPolyfill';
import { act, fireEvent, render, screen } from '@testing-library/react';
import TokenRevealDialog from '../../frontend/src/components/apiKeys/TokenRevealDialog';

const mockCopyText = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => (options?.name ? `${key}:${options.name}` : key),
  }),
}));
jest.mock('@/utils/clipboard', () => ({ copyText: (...args: unknown[]) => mockCopyText(...args) }));

const renderDialog = (kind: 'created' | 'reset' = 'created', onClose = jest.fn()) => {
  render(<TokenRevealDialog kind={kind} name="cursor" token="mcphub_secret" onClose={onClose} />);
  return onClose;
};

beforeEach(() => {
  mockCopyText.mockReset();
  mockCopyText.mockResolvedValue(true);
});

describe('the token reveal dialog', () => {
  it('is a labelled modal dialog titled with the key name', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent).toBe('tokenReveal.title:cursor');
  });

  it('titles a reset differently', () => {
    renderDialog('reset');
    expect(screen.getByText('tokenReveal.titleReset:cursor')).toBeTruthy();
  });

  it('warns that the token is shown once and shows it read-only', () => {
    renderDialog();
    expect(screen.getByText('tokenReveal.warning')).toBeTruthy();
    const field = screen.getByLabelText('settings.bearerKeyToken') as HTMLTextAreaElement;
    expect(field.value).toBe('mcphub_secret');
    expect(field.readOnly).toBe(true);
  });

  it('puts focus on Copy first', () => {
    renderDialog();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'common.copy' }));
  });

  it('copies the token and says so', async () => {
    renderDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.copy' }));
    });
    expect(mockCopyText).toHaveBeenCalledWith('mcphub_secret');
    expect(screen.getByRole('button', { name: 'common.copied' })).toBeTruthy();
  });

  it('asks to copy manually when copying fails', async () => {
    mockCopyText.mockResolvedValue(false);
    renderDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.copy' }));
    });
    expect(screen.getByRole('alert').textContent).toBe('tokenReveal.copyFailedManual');
  });

  it('keeps Done disabled until the token is confirmed as stored', () => {
    const onClose = renderDialog();
    const done = screen.getByRole('button', { name: 'tokenReveal.done' }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'tokenReveal.acknowledge' }));
    expect(done.disabled).toBe(false);
    fireEvent.click(done);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape and the backdrop until the token is confirmed', () => {
    const onClose = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'tokenReveal.acknowledge' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has no Cancel button', () => {
    renderDialog();
    expect(screen.queryByRole('button', { name: 'common.cancel' })).toBeNull();
  });

  it('gives focus back to the opener when it closes', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <TokenRevealDialog kind="created" name="cursor" token="t" onClose={jest.fn()} />,
    );
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
