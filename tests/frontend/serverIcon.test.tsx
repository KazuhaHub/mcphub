/**
 * @jest-environment jsdom
 */
import '../utils/textEncoderPolyfill';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { WorkspaceServer } from '../../frontend/src/types';
import ServerIcon from '../../frontend/src/components/ServerIcon';
import ServerIconField from '../../frontend/src/components/ServerIconField';
import WorkspaceServiceRow from '../../frontend/src/components/workspace/WorkspaceServiceRow';
import {
  clearServerIconCache,
  loadServerIcon,
  serverInitial,
} from '../../frontend/src/utils/serverIcon';
import { buildServerPayload } from '../../frontend/src/utils/serverFormPayload';
import { buildDuplicateSource } from '../../frontend/src/utils/serverDuplicate';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars?.name ? `${key}:${vars.name}` : key),
  }),
}));

const mockFetch = jest.fn();
jest.mock('@/utils/fetchInterceptor', () => ({
  fetchWithInterceptors: (...args: unknown[]) => mockFetch(...args),
}));

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const imageResponse = (type = 'image/png', ok = true) => ({
  ok,
  headers: { get: () => type },
  blob: () => Promise.resolve(new Blob(['x'], { type })),
});

let blobCounter = 0;
beforeEach(() => {
  clearServerIconCache();
  mockFetch.mockReset();
  blobCounter = 0;
  Object.assign(URL, { createObjectURL: jest.fn(() => `blob:icon-${++blobCounter}`) });
  (URL.createObjectURL as jest.Mock).mockClear();
});

describe('serverInitial', () => {
  it.each([
    ['notes', 'N'],
    ['  trim', 'T'],
    ['笔记本', '笔'],
    ['élan', 'É'],
    ['🙂smile', '🙂'],
    ['', '?'],
  ])('uses the first character of %j', (name, letter) => {
    expect(serverInitial(name)).toBe(letter);
  });
});

describe('ServerIcon', () => {
  it('shows a letter tile when the server has no icon', () => {
    render(<ServerIcon name="notes" />);
    const tile = screen.getByTestId('server-icon');
    expect(tile.getAttribute('data-icon')).toBe('letter');
    expect(tile.textContent).toBe('N');
    expect(tile.querySelector('img')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shows a data: preview straight away, only through an <img>', () => {
    render(<ServerIcon name="notes" icon={PNG} />);
    const img = screen.getByTestId('server-icon').querySelector('img')!;
    expect(img.getAttribute('src')).toBe(PNG);
    expect(img.getAttribute('alt')).toBe('');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('starts as the letter tile and swaps to the image fetched with the auth interceptors', async () => {
    mockFetch.mockResolvedValue(imageResponse());
    render(<ServerIcon name="notes" icon="/api/servers/notes/icon?v=abc123abc123" />);
    expect(screen.getByTestId('server-icon').getAttribute('data-icon')).toBe('letter');
    await waitFor(() =>
      expect(screen.getByTestId('server-icon').getAttribute('data-icon')).toBe('image'),
    );
    expect(screen.getByTestId('server-icon').querySelector('img')!.getAttribute('src')).toBe(
      'data:image/png;base64,eA==',
    );
    expect(mockFetch).toHaveBeenCalledWith('/api/servers/notes/icon?v=abc123abc123');
  });

  it('keeps the letter tile when the icon is gone (404) or is not an image', async () => {
    mockFetch.mockResolvedValueOnce(imageResponse('image/png', false));
    const { unmount } = render(<ServerIcon name="notes" icon="/api/servers/notes/icon?v=1" />);
    await act(async () => {});
    expect(screen.getByTestId('server-icon').getAttribute('data-icon')).toBe('letter');
    unmount();

    mockFetch.mockResolvedValueOnce(imageResponse('text/html'));
    render(<ServerIcon name="other" icon="/api/servers/other/icon?v=1" />);
    await act(async () => {});
    expect(screen.getByTestId('server-icon').getAttribute('data-icon')).toBe('letter');
  });

  it('falls back to the letter when the browser cannot decode the image', async () => {
    render(<ServerIcon name="notes" icon={PNG} />);
    fireEvent.error(screen.getByTestId('server-icon').querySelector('img')!);
    expect(screen.getByTestId('server-icon').getAttribute('data-icon')).toBe('letter');
  });

  it('follows the icon when it is replaced', async () => {
    mockFetch.mockResolvedValue(imageResponse());
    const { rerender } = render(<ServerIcon name="notes" icon="/api/servers/notes/icon?v=a" />);
    await waitFor(() => expect(screen.getByTestId('server-icon').getAttribute('data-icon')).toBe('image'));
    rerender(<ServerIcon name="notes" icon="/api/servers/notes/icon?v=b" />);
    await waitFor(() =>
      expect(screen.getByTestId('server-icon').querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/png;base64,/),
    );
    rerender(<ServerIcon name="notes" />);
    expect(screen.getByTestId('server-icon').getAttribute('data-icon')).toBe('letter');
  });
});

describe('loadServerIcon', () => {
  it('fetches each versioned URL once and reuses the blob', async () => {
    mockFetch.mockResolvedValue(imageResponse());
    const first = await loadServerIcon('/api/servers/a/icon?v=1');
    const again = await loadServerIcon('/api/servers/a/icon?v=1');
    expect(again).toBe(first);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await loadServerIcon('/api/servers/a/icon?v=2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure, so a later attempt can succeed', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    expect(await loadServerIcon('/api/servers/a/icon?v=1')).toBeNull();
    mockFetch.mockResolvedValueOnce(imageResponse());
    expect(await loadServerIcon('/api/servers/a/icon?v=1')).toBe('data:image/png;base64,eA==');
  });

  it('never produces a blob: URL, which would carry the dashboard origin', async () => {
    mockFetch.mockResolvedValue(imageResponse('image/svg+xml'));
    const shown = await loadServerIcon('/api/servers/a/icon?v=1');
    expect(shown).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

const row = (server: Partial<WorkspaceServer>) =>
  render(
    <WorkspaceServiceRow
      server={
        {
          name: 'notes',
          selected: true,
          enabled: true,
          toolCount: 1,
          riskCeiling: 'read',
          maxAllowedRisk: 'external',
          riskCounts: null,
          requiresPersonalCredential: false,
          credentialConfigured: false,
          status: { code: 'available', message: '', action: null },
          ...server,
        } as WorkspaceServer
      }
      credentialServers={null}
      busy={false}
      onToggle={jest.fn()}
      onOpen={jest.fn()}
      onAction={jest.fn()}
    />,
  );

describe('workspace list row', () => {
  it('shows the icon, or the letter tile when there is none', () => {
    const { unmount } = row({ name: 'notes', icon: PNG });
    expect(screen.getByTestId('server-icon').getAttribute('data-icon')).toBe('image');
    unmount();
    row({ name: 'tasks' });
    expect(screen.getByTestId('server-icon').textContent).toBe('T');
  });
});

describe('ServerIconField', () => {
  const file = (type: string, content = 'x') => new File([content], 'icon', { type });
  const mountField = (props: Partial<React.ComponentProps<typeof ServerIconField>> = {}) => {
    const onChange = jest.fn();
    render(<ServerIconField name="notes" onChange={onChange} {...props} />);
    return onChange;
  };
  const pick = (f: File) =>
    fireEvent.change(screen.getByTestId('server-icon-input'), { target: { files: [f] } });

  it('offers an upload and no remove while the server has no icon', () => {
    mountField();
    expect(screen.getByText('server.iconUpload')).toBeTruthy();
    expect(screen.queryByTestId('server-icon-remove')).toBeNull();
  });

  it('turns a chosen PNG into the pending data URL', async () => {
    const onChange = mountField();
    pick(file('image/png', 'pixels'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0]).toMatch(/^data:image\/png;base64,/);
  });

  it('refuses a type that is not allowed, with a message and no change', async () => {
    const onChange = mountField();
    pick(file('image/gif'));
    expect((await screen.findByRole('alert')).textContent).toBe('settings.branding.error.type');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses an SVG over 256 KB', async () => {
    const onChange = mountField();
    pick(file('image/svg+xml', '<svg>' + 'a'.repeat(257 * 1024) + '</svg>'));
    expect((await screen.findByRole('alert')).textContent).toBe('settings.branding.error.size');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('previews the stored icon, offers Replace and Remove, and removing sends the empty string', () => {
    const onChange = mountField({ stored: PNG });
    expect(screen.getByTestId('server-icon').getAttribute('data-icon')).toBe('image');
    expect(screen.getByText('server.iconReplace')).toBeTruthy();
    fireEvent.click(screen.getByTestId('server-icon-remove'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('after removing, shows the letter tile and offers an upload again', () => {
    mountField({ stored: PNG, value: '' });
    expect(screen.getByTestId('server-icon').getAttribute('data-icon')).toBe('letter');
    expect(screen.getByText('server.iconUpload')).toBeTruthy();
  });

  it('removing a pending image on a server without an icon just drops the choice', () => {
    const onChange = mountField({ value: PNG });
    fireEvent.click(screen.getByTestId('server-icon-remove'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});

describe('server form payload and duplicate', () => {
  const build = (iconEdit?: string) =>
    buildServerPayload({
      formData: {
        name: 'notes',
        url: 'https://example.com/mcp',
        command: '',
        arguments: '',
        env: [],
        headers: [],
        iconEdit,
      },
      serverType: 'streamable-http',
      envVars: [],
      headerVars: [],
    }).config;

  it('sends the icon only when the admin chose or removed one', () => {
    expect(build()).not.toHaveProperty('icon');
    expect(build(PNG).icon).toBe(PNG);
    expect(build('')).toHaveProperty('icon', '');
  });

  it('starts a duplicate without the source icon', () => {
    const copy = buildDuplicateSource({
      name: 'notes',
      status: 'connected',
      config: { type: 'sse', url: 'https://example.com/sse', icon: '/api/servers/notes/icon?v=1' },
    } as never);
    expect(copy.config).not.toHaveProperty('icon');
  });
});
