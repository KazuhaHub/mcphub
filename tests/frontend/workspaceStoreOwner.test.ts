/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import {
  bindWorkspaceStore,
  resetWorkspaceStore,
  seedWorkspaceStore,
  useWorkspaceSnapshot,
} from '../../frontend/src/hooks/useWorkspaceData';

// The store outlives a sign-out in the same tab; one user's data must never reach the next.
describe('workspace store owner', () => {
  afterEach(() => resetWorkspaceStore());

  it('keeps the data for the same user and drops it on sign-out or another user', () => {
    act(() => bindWorkspaceStore('alice'));
    act(() => seedWorkspaceStore({ servers: [{ name: 'alice-only' } as never] }));
    const { result } = renderHook(() => useWorkspaceSnapshot());
    expect(result.current.servers).toHaveLength(1);

    act(() => bindWorkspaceStore('alice'));
    expect(result.current.servers).toHaveLength(1);

    act(() => bindWorkspaceStore('bob'));
    expect(result.current.servers).toHaveLength(0);
    expect(result.current.loaded).toBe(false);

    act(() => seedWorkspaceStore({ servers: [{ name: 'bob-only' } as never] }));
    act(() => bindWorkspaceStore(null));
    expect(result.current.servers).toHaveLength(0);
  });
});
