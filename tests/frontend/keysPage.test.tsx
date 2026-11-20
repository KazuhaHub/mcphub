/**
 * @jest-environment jsdom
 */
import '../utils/textEncoderPolyfill';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import KeysPage from '../../frontend/src/pages/KeysPage';

let mockUser = { username: 'alice', isAdmin: false };

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ auth: { user: mockUser } }) }));
jest.mock('@/components/apiKeys/BearerKeysPanel', () => ({
  __esModule: true,
  default: ({ mode }: { mode: string }) => <div data-testid="panel" data-mode={mode} />,
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <KeysPage />
    </MemoryRouter>,
  );

describe('the API keys page', () => {
  it('is a page of its own with the personal panel', () => {
    mockUser = { username: 'alice', isAdmin: false };
    renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('nav.keys');
    expect(screen.getByText('apiKeys.subtitle')).toBeTruthy();
    expect(screen.getByTestId('panel').getAttribute('data-mode')).toBe('personal');
    expect(screen.queryByTestId('api-keys-admin-hint')).toBeNull();
  });

  it('points administrators to the authentication settings', () => {
    mockUser = { username: 'root', isAdmin: true };
    renderPage();
    const link = screen.getByRole('link', { name: 'settings.authenticationSection' });
    expect(link.getAttribute('href')).toBe('/settings?section=authentication');
  });
});
