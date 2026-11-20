/**
 * @jest-environment jsdom
 */
import '../utils/textEncoderPolyfill';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UserProfileMenu from '../../frontend/src/components/ui/UserProfileMenu';

let mockUser: { username: string; isAdmin: boolean; permissions?: string[] } = {
  username: 'alice',
  isAdmin: false,
};
let mockWorkspaceEnabled = true;
const mockNavigate = jest.fn();
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ auth: { user: mockUser }, logout: jest.fn() }),
}));
jest.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({ workspaceEnabled: mockWorkspaceEnabled }),
}));
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
jest.mock('@/components/ui/AboutDialog', () => ({ __esModule: true, default: () => null }));
jest.mock('@/services/changelogService', () => ({
  fetchChangelogUpdateInfo: jest.fn(() => Promise.resolve(null)),
  shouldShowUpdateBadge: () => false,
}));

const open = (path = '/workspace', onOverlayOpen?: () => void) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <UserProfileMenu collapsed={false} version="1.0.0" onOverlayOpen={onOverlayOpen} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /alice/ }));
};

beforeEach(() => {
  mockNavigate.mockClear();
  mockWorkspaceEnabled = true;
});

describe('the user menu', () => {
  it('gives an ordinary user Account settings and Sign out, nothing admin', () => {
    mockUser = { username: 'alice', isAdmin: false };
    open();
    expect(screen.getByText('nav.accountSettings')).toBeTruthy();
    expect(screen.getByText('app.logout')).toBeTruthy();
    for (const gone of ['nav.adminConsole', 'nav.backToWorkspace', 'about.title']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it('opens the account settings page and tells the drawer around it', () => {
    mockUser = { username: 'alice', isAdmin: false };
    const onOverlayOpen = jest.fn();
    open('/workspace', onOverlayOpen);
    fireEvent.click(screen.getByText('nav.accountSettings'));
    expect(mockNavigate).toHaveBeenCalledWith('/account');
    expect(onOverlayOpen).toHaveBeenCalled();
  });

  it('offers an administrator the Admin console from the workspace, and About', () => {
    mockUser = { username: 'alice', isAdmin: true };
    open('/workspace');
    expect(screen.getByText('about.title')).toBeTruthy();
    expect(screen.queryByText('nav.backToWorkspace')).toBeNull();
    fireEvent.click(screen.getByText('nav.adminConsole'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('offers the way back to the workspace from an admin page', () => {
    mockUser = { username: 'alice', isAdmin: true };
    open('/servers');
    expect(screen.queryByText('nav.adminConsole')).toBeNull();
    fireEvent.click(screen.getByText('nav.backToWorkspace'));
    expect(mockNavigate).toHaveBeenCalledWith('/workspace');
  });

  it('leads a person with only a settings permission to Settings', () => {
    mockUser = { username: 'alice', isAdmin: false, permissions: ['settings:route_config'] };
    open('/workspace');
    fireEvent.click(screen.getByText('nav.adminConsole'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings');
  });

  it('has no area switch while Workspace Mode is off', () => {
    mockWorkspaceEnabled = false;
    mockUser = { username: 'alice', isAdmin: true };
    open('/dashboard');
    expect(screen.getByText('nav.accountSettings')).toBeTruthy();
    expect(screen.queryByText('nav.adminConsole')).toBeNull();
    expect(screen.queryByText('nav.backToWorkspace')).toBeNull();
  });
});
