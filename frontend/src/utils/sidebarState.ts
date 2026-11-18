// Sidebar state for the app shell. Wide screens use an expanded or collapsed rail; narrow
// screens (phones) use an off-canvas drawer that is closed until the menu button opens it.

export interface SidebarState {
  narrow: boolean;
  // Rail state on wide screens. Always false while narrow: the drawer shows full labels.
  collapsed: boolean;
  // Drawer state on narrow screens. Always false while wide.
  drawerOpen: boolean;
}

export type SidebarAction =
  | { type: 'viewport'; narrow: boolean }
  | { type: 'toggle' }
  | { type: 'close' };

export const initialSidebarState = (narrow: boolean): SidebarState => ({
  narrow,
  collapsed: false,
  drawerOpen: false,
});

export const sidebarReducer = (state: SidebarState, action: SidebarAction): SidebarState => {
  switch (action.type) {
    case 'viewport':
      // A crossing resets the layout: the rail expands on wide screens, the drawer closes on
      // narrow ones. Repeating the current state keeps the user's menu-button override.
      return action.narrow === state.narrow ? state : initialSidebarState(action.narrow);
    case 'toggle':
      return state.narrow
        ? { ...state, drawerOpen: !state.drawerOpen }
        : { ...state, collapsed: !state.collapsed };
    case 'close':
      return state.drawerOpen ? { ...state, drawerOpen: false } : state;
    default:
      return state;
  }
};

// Where Tab should go inside a modal container so focus never leaves it. Returns the index
// to focus, or null when the browser's default movement stays within the container.
export const trapTabTarget = (count: number, activeIndex: number, shift: boolean): number | null => {
  if (count === 0) return null;
  // Focus is outside the container (or on the container itself): pull it in.
  if (activeIndex < 0) return shift ? count - 1 : 0;
  if (shift && activeIndex === 0) return count - 1;
  if (!shift && activeIndex === count - 1) return 0;
  return null;
};
