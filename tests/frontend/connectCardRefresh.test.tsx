/**
 * @jest-environment jsdom
 */
import { act, render, waitFor } from '@testing-library/react';
import ConnectCard from '../../frontend/src/components/connect/ConnectCard';
import { notifyWorkspaceChanged } from '../../frontend/src/utils/workspaceEvents';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({ smartRoutingConfig: { enabled: false } }),
}));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
const mockServers = jest.fn();
const mockEndpoints = jest.fn();
jest.mock('@/services/workspaceService', () => ({
  fetchWorkspaceServers: () => mockServers(),
  fetchWorkspaceEndpoints: () => mockEndpoints(),
  fetchCredentialBindings: jest.fn(() => Promise.resolve([])),
  launchPersonalOAuth: jest.fn(),
}));

describe('the Connect card', () => {
  it('reloads at once when anything on the workspace page reports a change', async () => {
    mockServers.mockResolvedValue([]);
    mockEndpoints.mockResolvedValue({ aggregate: 'https://hub.example.com/u/mcp', servers: [] });
    render(<ConnectCard />);
    await waitFor(() => expect(mockServers).toHaveBeenCalledTimes(1));
    await act(async () => {
      notifyWorkspaceChanged();
    });
    await waitFor(() => expect(mockServers).toHaveBeenCalledTimes(2));
    expect(mockEndpoints).toHaveBeenCalledTimes(2);
  });
});
