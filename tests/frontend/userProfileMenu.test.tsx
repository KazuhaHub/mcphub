/**
 * @jest-environment jsdom
 */
import '../utils/textEncoderPolyfill';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UserProfileMenu from '../../frontend/src/components/ui/UserProfileMenu';

let mockUser = { username: 'alice', isAdmin: false };
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ auth: { user: mockUser }, logout: jest.fn() }),
}));
jest.mock('@/components/ui/AboutDialog', () => ({ __esModule: true, default: () => null }));
jest.mock('@/services/changelogService', () => ({
  fetchChangelogUpdateInfo: jest.fn(() => Promise.resolve(null)),
  shouldShowUpdateBadge: () => false,
}));

const open = () => {
  render(
    <MemoryRouter>
      <UserProfileMenu collapsed={false} version="1.0.0" />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /alice/ }));
};

describe('the user menu', () => {
  it('holds only Sign out for an ordinary user: the account pages are in the sidebar', () => {
    mockUser = { username: 'alice', isAdmin: false };
    open();
    expect(screen.getByText('app.logout')).toBeTruthy();
    for (const gone of ['nav.settings', 'passkeys.title', 'oauthApprovals.title', 'about.title']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it('adds About for an administrator, and still none of the account pages', () => {
    mockUser = { username: 'alice', isAdmin: true };
    open();
    expect(screen.getByText('about.title')).toBeTruthy();
    expect(screen.getByText('app.logout')).toBeTruthy();
    for (const gone of ['nav.settings', 'passkeys.title', 'oauthApprovals.title']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });
});
