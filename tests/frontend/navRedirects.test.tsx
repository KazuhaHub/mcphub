/**
 * @jest-environment jsdom
 */
import '../utils/textEncoderPolyfill';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { LegacyRedirect } from '../../frontend/src/components/NavRedirects';

jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ auth: { user: null } }) }));
jest.mock('@/contexts/SettingsContext', () => ({ useSettings: () => ({ workspaceEnabled: true }) }));

const Where: React.FC = () => {
  const { pathname, search, hash } = useLocation();
  return <span data-testid="where">{`${pathname}${search}${hash}`}</span>;
};

const redirectFrom = (url: string) => {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/old" element={<LegacyRedirect to="/account?tab=apps" />} />
        <Route path="/account" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByTestId('where').textContent;
};

describe('LegacyRedirect', () => {
  it('goes to the target with its tab', () => {
    expect(redirectFrom('/old')).toBe('/account?tab=apps');
  });

  it('keeps the hash', () => {
    expect(redirectFrom('/old#section')).toBe('/account?tab=apps#section');
  });

  it('keeps incoming query parameters and lets the target tab win', () => {
    expect(redirectFrom('/old?client=abc&tab=password')).toBe('/account?client=abc&tab=apps');
  });
});
