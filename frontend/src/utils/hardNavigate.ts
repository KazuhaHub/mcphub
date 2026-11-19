/** Full-page navigation, in its own module so tests can observe it (jsdom's location is fixed). */
export const hardNavigate = (url: string): void => {
  window.location.assign(url);
};
