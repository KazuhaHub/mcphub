/**
 * @jest-environment jsdom
 */
import '../utils/textEncoderPolyfill';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ResetBearerKeyDialog from '../../frontend/src/components/ResetBearerKeyDialog';

const mockApiPost = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => (options?.name ? `${key}:${options.name}` : key),
  }),
}));
jest.mock('@/utils/fetchInterceptor', () => ({
  apiPost: (...args: unknown[]) => mockApiPost(...args),
}));
jest.mock('@/utils/clipboard', () => ({ copyText: jest.fn(() => Promise.resolve(true)) }));

const key = { id: 'k1', name: 'cursor', token: 'mcphub_a...', enabled: true, accessType: 'all' as const };

const renderDialog = () => {
  const onClose = jest.fn();
  const onReset = jest.fn(() => Promise.resolve());
  render(<ResetBearerKeyDialog keyData={key} onClose={onClose} onReset={onReset} />);
  return { onClose, onReset };
};

beforeEach(() => mockApiPost.mockReset());

describe('the reset key dialog', () => {
  it('asks for confirmation first, with focus on Cancel', () => {
    renderDialog();
    expect(screen.getByText('settings.resetBearerKeyConfirm')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'common.cancel' }));
  });

  it('closes on Escape before anything was reset', () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('reveals the new token in the shared dialog body and then needs confirmation', async () => {
    mockApiPost.mockResolvedValue({ success: true, data: { ...key, token: 'mcphub_new' } });
    const { onClose, onReset } = renderDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));
    });
    expect(mockApiPost).toHaveBeenCalledWith('/auth/keys/k1/reset', {});
    expect(onReset).toHaveBeenCalled();
    expect(screen.getByText('tokenReveal.titleReset:cursor')).toBeTruthy();
    expect((screen.getByLabelText('settings.bearerKeyToken') as HTMLTextAreaElement).value).toBe(
      'mcphub_new',
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'common.copy' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'tokenReveal.done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the error and stays in the confirm phase when the reset fails', async () => {
    mockApiPost.mockResolvedValue({ success: false, message: 'nope' });
    renderDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));
    });
    expect(screen.getByRole('alert').textContent).toBe('nope');
    expect(screen.queryByText('tokenReveal.titleReset:cursor')).toBeNull();
  });
});
