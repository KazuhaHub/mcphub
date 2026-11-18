/**
 * Post-login return targets. A target is only ever followed as a root-relative path on this
 * origin, checked by the same rule Better Auth applies to relative callback URLs
 * (`isSafeRelativeURL` in better-auth's trusted-origins module, which it does not export):
 * starts with one `/`, no backslash, no control character, no encoded `/` or `\` in the path,
 * and it stays on the origin when a browser parses it.
 */

// C0 and C1 control characters, which URL parsers strip or reinterpret (tab, newline, ...)
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const ENCODED_PATH_SEPARATOR = /%2f|%5c/i;
const PARSER_ORIGIN = 'https://return-target.invalid';

export const isSafeRelativeUrl = (value: string): boolean => {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    CONTROL_CHARACTERS.test(value)
  ) {
    return false;
  }
  const pathEnd = value.search(/[?#]/);
  const path = pathEnd === -1 ? value : value.slice(0, pathEnd);
  if (ENCODED_PATH_SEPARATOR.test(path)) return false;
  try {
    return new URL(value, PARSER_ORIGIN).origin === PARSER_ORIGIN;
  } catch {
    return false;
  }
};

/**
 * Reduces a `?returnUrl` value to a safe same-origin path, or null. The raw value, the parsed
 * URL's origin and the final path are all checked: dot segments and an own-origin absolute URL
 * can normalise to `//host`, which a browser would follow off-site.
 */
export const sanitizeReturnUrl = (value: string | null, origin: string): string | null => {
  if (!value || value.includes('\\') || CONTROL_CHARACTERS.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const path = `${url.pathname}${url.search}${url.hash}`;
  return isSafeRelativeUrl(path) ? path : null;
};
