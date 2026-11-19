/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import UserProfileMenu from '../../frontend/src/components/ui/UserProfileMenu';
import { useAppVersion, resetAppVersionCache } from '../../frontend/src/hooks/useAppVersion';

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

let mockUser: { username: string; isAdmin: boolean } | null = null;
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    auth: { isAuthenticated: Boolean(mockUser), loading: false, user: mockUser },
    logout: jest.fn(),
  }),
}));

const mockApiGet = jest.fn();
jest.mock('@/utils/fetchInterceptor', () => ({ apiGet: (...args: unknown[]) => mockApiGet(...args) }));
const mockFetchInfo = jest.fn();
jest.mock('@/services/changelogService', () => ({
  fetchChangelogUpdateInfo: (...args: unknown[]) => mockFetchInfo(...args),
  shouldShowUpdateBadge: (info: any) => Boolean(info?.hasUpdate),
  dismissUpdateVersion: jest.fn(),
  isUpdateDismissed: () => false,
}));

const VersionProbe = () => <span data-testid="version">{useAppVersion()}</span>;

beforeEach(() => {
  jest.clearAllMocks();
  resetAppVersionCache();
  mockApiGet.mockResolvedValue({ success: true, data: { version: '2.6.0' } });
  mockFetchInfo.mockResolvedValue({ hasUpdate: true, latestVersion: '9.9.9', entries: [] });
});

describe('version and update information are administrator-only', () => {
  it('does not request /version for a non-admin and exposes no version', async () => {
    mockUser = { username: 'alice', isAdmin: false };
    await act(async () => {
      render(<VersionProbe />);
    });
    expect(mockApiGet).not.toHaveBeenCalled();
    expect(screen.getByTestId('version').textContent).toBe('');
  });

  it('loads the version for an admin', async () => {
    mockUser = { username: 'root', isAdmin: true };
    await act(async () => {
      render(<VersionProbe />);
    });
    expect(mockApiGet).toHaveBeenCalledWith('/version');
    expect(screen.getByTestId('version').textContent).toBe('2.6.0');
  });

  it('gives a non-admin no About entry, no update check and no badge', async () => {
    mockUser = { username: 'alice', isAdmin: false };
    const { container } = await act(async () => render(<UserProfileMenu collapsed={false} version="" />));
    expect(mockFetchInfo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('about.title')).toBeNull();
    expect(container.querySelector('.bg-red-500')).toBeNull();
  });

  it('keeps About, the update check and the badge for an admin', async () => {
    mockUser = { username: 'root', isAdmin: true };
    const { container } = await act(async () => render(<UserProfileMenu collapsed={false} version="2.6.0" />));
    expect(mockFetchInfo).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.bg-red-500')).not.toBeNull();
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.getByText('about.title')).toBeTruthy();
  });
});
