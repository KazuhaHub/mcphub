import {
  initialSidebarState,
  sidebarReducer,
  trapTabTarget,
} from '../../frontend/src/utils/sidebarState';

describe('sidebarReducer', () => {
  it('starts expanded on wide screens and closed on narrow ones', () => {
    expect(initialSidebarState(false)).toEqual({ narrow: false, collapsed: false, drawerOpen: false });
    expect(initialSidebarState(true)).toEqual({ narrow: true, collapsed: false, drawerOpen: false });
  });

  it('toggles the rail on wide screens and never opens the drawer', () => {
    let state = initialSidebarState(false);
    state = sidebarReducer(state, { type: 'toggle' });
    expect(state).toMatchObject({ collapsed: true, drawerOpen: false });
    state = sidebarReducer(state, { type: 'toggle' });
    expect(state).toMatchObject({ collapsed: false, drawerOpen: false });
  });

  it('toggles the drawer on narrow screens and never collapses the rail', () => {
    let state = initialSidebarState(true);
    state = sidebarReducer(state, { type: 'toggle' });
    expect(state).toMatchObject({ collapsed: false, drawerOpen: true });
    state = sidebarReducer(state, { type: 'toggle' });
    expect(state).toMatchObject({ collapsed: false, drawerOpen: false });
  });

  it('closes an open drawer, and leaves other states untouched', () => {
    const open = sidebarReducer(initialSidebarState(true), { type: 'toggle' });
    expect(sidebarReducer(open, { type: 'close' }).drawerOpen).toBe(false);

    const wide = initialSidebarState(false);
    expect(sidebarReducer(wide, { type: 'close' })).toBe(wide);
    const collapsed = sidebarReducer(wide, { type: 'toggle' });
    expect(sidebarReducer(collapsed, { type: 'close' })).toBe(collapsed);
  });

  it('resets the layout when the viewport crosses the breakpoint', () => {
    const collapsed = sidebarReducer(initialSidebarState(false), { type: 'toggle' });
    expect(sidebarReducer(collapsed, { type: 'viewport', narrow: true })).toEqual(
      initialSidebarState(true),
    );
    const open = sidebarReducer(initialSidebarState(true), { type: 'toggle' });
    expect(sidebarReducer(open, { type: 'viewport', narrow: false })).toEqual(
      initialSidebarState(false),
    );
  });

  it('keeps a user override when the viewport reports the same state again', () => {
    const collapsed = sidebarReducer(initialSidebarState(false), { type: 'toggle' });
    expect(sidebarReducer(collapsed, { type: 'viewport', narrow: false })).toBe(collapsed);
    const open = sidebarReducer(initialSidebarState(true), { type: 'toggle' });
    expect(sidebarReducer(open, { type: 'viewport', narrow: true })).toBe(open);
  });
});

describe('trapTabTarget', () => {
  it('lets Tab move normally inside the container', () => {
    expect(trapTabTarget(4, 1, false)).toBeNull();
    expect(trapTabTarget(4, 2, true)).toBeNull();
  });

  it('wraps at both ends', () => {
    expect(trapTabTarget(4, 3, false)).toBe(0);
    expect(trapTabTarget(4, 0, true)).toBe(3);
  });

  it('pulls focus in when it is outside the container', () => {
    expect(trapTabTarget(4, -1, false)).toBe(0);
    expect(trapTabTarget(4, -1, true)).toBe(3);
  });

  it('does nothing when nothing is focusable', () => {
    expect(trapTabTarget(0, -1, false)).toBeNull();
  });
});
