/**
 * @jest-environment jsdom
 */
import '../utils/textEncoderPolyfill';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import BearerKeysPanel from '../../frontend/src/components/apiKeys/BearerKeysPanel';

type Key = {
  id: string;
  name: string;
  token: string;
  tokenPrefix?: string;
  enabled: boolean;
  kind?: 'system' | 'user';
  owner?: string;
  accessType: 'all' | 'groups' | 'servers' | 'custom' | 'exclude';
  allowedGroups?: string[];
};

const keys: Key[] = [
  { id: '1', name: 'mine', token: 'mcphub_a...', tokenPrefix: 'mcphub_a', enabled: true, kind: 'user', owner: 'alice', accessType: 'all' },
  { id: '2', name: 'theirs', token: 'mcphub_b...', tokenPrefix: 'mcphub_b', enabled: true, kind: 'user', owner: 'bob', accessType: 'all' },
  { id: '3', name: 'ci-system', token: 'mcphub_c...', tokenPrefix: 'mcphub_c', enabled: true, kind: 'system', accessType: 'all' },
];

const mockCreate = jest.fn();
const mockRefresh = jest.fn();
const mockApiGet = jest.fn();
let mockUser = { username: 'alice', isAdmin: false };
let mockKeys: Key[] = keys;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ auth: { user: mockUser } }),
}));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('@/contexts/ServerContext', () => ({
  useServerContext: () => ({ allServers: [{ name: 'files' }] }),
}));
jest.mock('@/hooks/useGroupData', () => ({
  useGroupData: () => ({ groups: [{ id: 'g1', name: 'Team' }] }),
}));
jest.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    bearerKeys: mockKeys,
    loading: false,
    createBearerKey: (...args: unknown[]) => mockCreate(...args),
    updateBearerKey: jest.fn(),
    deleteBearerKey: jest.fn(),
    refreshBearerKeys: (...args: unknown[]) => mockRefresh(...args),
  }),
}));
jest.mock('@/utils/fetchInterceptor', () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
}));
jest.mock('@/utils/clipboard', () => ({ copyText: jest.fn(() => Promise.resolve(true)) }));
jest.mock('@/components/ui/MultiSelect', () => ({ MultiSelect: () => <div data-testid="multi" /> }));
jest.mock('@/components/ResetBearerKeyDialog', () => ({
  __esModule: true,
  default: () => <div data-testid="reset-dialog" />,
}));

const renderPanel = async (mode: 'personal' | 'admin') => {
  await act(async () => {
    render(<BearerKeysPanel mode={mode} />);
  });
};

const openForm = () => fireEvent.click(screen.getByRole('button', { name: 'settings.addBearerKey' }));

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { username: 'alice', isAdmin: false };
  mockKeys = keys;
  mockRefresh.mockResolvedValue(undefined);
  mockApiGet.mockResolvedValue({ success: true, data: [{ username: 'alice' }, { username: 'bob' }] });
});

describe('the personal API keys panel', () => {
  it('lists only the signed-in person’s own user-level keys, even for an administrator', async () => {
    mockUser = { username: 'alice', isAdmin: true };
    await renderPanel('personal');
    expect(screen.getByText('mine')).toBeTruthy();
    expect(screen.queryByText('theirs')).toBeNull();
    expect(screen.queryByText('ci-system')).toBeNull();
    // An administrator's personal panel has no scope filter and loads no user list.
    expect(screen.queryByLabelText('settings.bearerKeyScopeFilter')).toBeNull();
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('refreshes the keys when it opens', async () => {
    await renderPanel('personal');
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('offers no key type or owner, and only the two personal scopes', async () => {
    await renderPanel('personal');
    openForm();
    expect(screen.queryByLabelText('settings.bearerKeyKind')).toBeNull();
    expect(screen.queryByLabelText('settings.bearerKeyOwner')).toBeNull();
    const scope = screen.getByLabelText('settings.bearerKeyAccessType') as HTMLSelectElement;
    expect(Array.from(scope.options).map((option) => option.value)).toEqual(['all', 'groups']);
  });

  it('creates a user-level key without an owner and reveals its token once', async () => {
    mockCreate.mockResolvedValue({ ...keys[0], id: '9', name: 'cursor', token: 'mcphub_plain' });
    await renderPanel('personal');
    openForm();
    fireEvent.change(screen.getByLabelText('settings.bearerKeyName'), { target: { value: 'cursor' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'settings.addBearerKeyButton' }));
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const payload = mockCreate.mock.calls[0][0];
    expect(payload).toMatchObject({ name: 'cursor', kind: 'user', accessType: 'all' });
    expect(payload.owner).toBeUndefined();

    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('settings.bearerKeyToken') as HTMLTextAreaElement).value).toBe(
      'mcphub_plain',
    );
    // The form is gone and the list was refreshed underneath.
    expect(screen.queryByLabelText('settings.bearerKeyName')).toBeNull();
    expect(mockRefresh.mock.calls.length).toBeGreaterThan(1);

    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'tokenReveal.done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.textContent).not.toContain('mcphub_plain');
  });

  it('requires a name', async () => {
    await renderPanel('personal');
    openForm();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'settings.addBearerKeyButton' }));
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('keeps the form and shows no token when creation fails', async () => {
    mockCreate.mockResolvedValue(null);
    await renderPanel('personal');
    openForm();
    fireEvent.change(screen.getByLabelText('settings.bearerKeyName'), { target: { value: 'x' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'settings.addBearerKeyButton' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('settings.bearerKeyName')).toBeTruthy();
  });

  it('says so when there are no keys yet', async () => {
    mockKeys = [];
    await renderPanel('personal');
    expect(screen.getByText('settings.noBearerKeys')).toBeTruthy();
  });
});

describe('the admin API keys panel', () => {
  beforeEach(() => {
    mockUser = { username: 'root', isAdmin: true };
  });

  it('lists every key and loads the users', async () => {
    await renderPanel('admin');
    for (const name of ['mine', 'theirs', 'ci-system']) expect(screen.getByText(name)).toBeTruthy();
    expect(mockApiGet).toHaveBeenCalledWith('/users');
  });

  it('filters by scope', async () => {
    await renderPanel('admin');
    fireEvent.change(screen.getByLabelText('settings.bearerKeyScopeFilter'), {
      target: { value: 'system' },
    });
    expect(screen.getByText('ci-system')).toBeTruthy();
    expect(screen.queryByText('mine')).toBeNull();
  });

  it('offers key type and, for user-level keys, an owner', async () => {
    await renderPanel('admin');
    openForm();
    const kind = screen.getByLabelText('settings.bearerKeyKind') as HTMLSelectElement;
    expect(screen.queryByLabelText('settings.bearerKeyOwner')).toBeNull();
    fireEvent.change(kind, { target: { value: 'user' } });
    const owner = screen.getByLabelText('settings.bearerKeyOwner') as HTMLSelectElement;
    expect(Array.from(owner.options).map((option) => option.value)).toEqual(['', 'alice', 'bob']);
  });

  it('creates a user-level key for the chosen owner', async () => {
    mockCreate.mockResolvedValue({ ...keys[1], id: '9', name: 'agent', token: 'mcphub_plain' });
    await renderPanel('admin');
    openForm();
    fireEvent.change(screen.getByLabelText('settings.bearerKeyName'), { target: { value: 'agent' } });
    fireEvent.change(screen.getByLabelText('settings.bearerKeyKind'), { target: { value: 'user' } });
    fireEvent.change(screen.getByLabelText('settings.bearerKeyOwner'), { target: { value: 'bob' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'settings.addBearerKeyButton' }));
    });
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ name: 'agent', kind: 'user', owner: 'bob' });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('refuses a user-level key without an owner', async () => {
    await renderPanel('admin');
    openForm();
    fireEvent.change(screen.getByLabelText('settings.bearerKeyName'), { target: { value: 'agent' } });
    fireEvent.change(screen.getByLabelText('settings.bearerKeyKind'), { target: { value: 'user' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'settings.addBearerKeyButton' }));
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates system-level keys by default', async () => {
    mockCreate.mockResolvedValue({ ...keys[2], id: '9', name: 'svc', token: 'mcphub_plain' });
    await renderPanel('admin');
    openForm();
    fireEvent.change(screen.getByLabelText('settings.bearerKeyName'), { target: { value: 'svc' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'settings.addBearerKeyButton' }));
    });
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ name: 'svc', kind: 'system' });
    expect(mockCreate.mock.calls[0][0].owner).toBeUndefined();
  });
});
