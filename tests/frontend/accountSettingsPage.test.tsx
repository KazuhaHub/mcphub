/**
 * @jest-environment jsdom
 */
import '../utils/textEncoderPolyfill';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AccountSettingsPage from '../../frontend/src/pages/AccountSettingsPage';

let mockWorkspaceEnabled = true;
const mockSuccess: { current?: () => void } = {};
const mockNavigate = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ auth: { user: { username: 'alice', isAdmin: false } } }),
}));
jest.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({ workspaceEnabled: mockWorkspaceEnabled }),
}));
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
jest.mock('@/components/ChangePasswordForm', () => ({
  __esModule: true,
  default: (props: { showTitle?: boolean; onSuccess?: () => void }) => {
    mockSuccess.current = props.onSuccess;
    return <div data-testid="password-panel" data-title={String(props.showTitle)} />;
  },
}));
jest.mock('@/pages/PasskeysPage', () => ({
  __esModule: true,
  default: (props: { embedded?: boolean }) => (
    <div data-testid="passkeys-panel" data-embedded={String(props.embedded)} />
  ),
}));
jest.mock('@/pages/OAuthApprovalsPage', () => ({
  __esModule: true,
  default: (props: { embedded?: boolean }) => (
    <div data-testid="apps-panel" data-embedded={String(props.embedded)} />
  ),
}));

const Where: React.FC = () => {
  const { search } = useLocation();
  return <span data-testid="where">{search}</span>;
};

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/account"
          element={
            <>
              <AccountSettingsPage />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  mockWorkspaceEnabled = true;
  mockNavigate.mockClear();
  jest.useRealTimers();
});

describe('the account settings page', () => {
  it('opens on the password tab and hides the embedded pages’ own titles', () => {
    renderAt('/account');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('account.title');
    expect(screen.getByRole('tab', { name: 'account.tabs.password' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('password-panel').getAttribute('data-title')).toBe('false');
  });

  it.each([
    ['passkeys', 'passkeys-panel'],
    ['apps', 'apps-panel'],
    ['password', 'password-panel'],
  ])('shows the %s tab from the address', (tab, panel) => {
    renderAt(`/account?tab=${tab}`);
    expect(screen.getByTestId(panel)).toBeTruthy();
  });

  it('shows the embedded variants of the other pages', () => {
    renderAt('/account?tab=passkeys');
    expect(screen.getByTestId('passkeys-panel').getAttribute('data-embedded')).toBe('true');
  });

  it('falls back to the password tab for an unknown tab', () => {
    renderAt('/account?tab=nonsense');
    expect(screen.getByTestId('password-panel')).toBeTruthy();
  });

  it('keeps the selected tab in the address', () => {
    renderAt('/account');
    fireEvent.click(screen.getByRole('tab', { name: 'account.tabs.apps' }));
    expect(screen.getByTestId('where').textContent).toBe('?tab=apps');
    expect(screen.getByTestId('apps-panel')).toBeTruthy();
  });

  it('moves between tabs with the arrow keys and only the selected one is tabbable', () => {
    renderAt('/account');
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(screen.getByTestId('passkeys-panel')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'account.tabs.passkeys' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'account.tabs.password' }).getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(list, { key: 'End' });
    expect(screen.getByTestId('apps-panel')).toBeTruthy();
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(screen.getByTestId('password-panel')).toBeTruthy();
  });

  it('goes home a moment after the password was changed', () => {
    jest.useFakeTimers();
    renderAt('/account');
    mockSuccess.current?.();
    expect(mockNavigate).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2000);
    expect(mockNavigate).toHaveBeenCalledWith('/workspace');
  });

  it('goes to the dashboard when Workspace Mode is off', () => {
    jest.useFakeTimers();
    mockWorkspaceEnabled = false;
    renderAt('/account');
    mockSuccess.current?.();
    jest.advanceTimersByTime(2000);
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });
});
