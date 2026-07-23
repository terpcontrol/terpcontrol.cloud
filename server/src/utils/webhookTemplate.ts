/**
 * Minimal {{placeholder}} substitution for alarm webhook payloads and URLs.
 *
 * Strings without "{{" pass through completely unchanged, so every payload
 * stored before this feature existed behaves exactly as it always has.
 * Unknown placeholders resolve to an empty string.
 *
 * Modes:
 *  - 'json': values are escaped so substitution inside a JSON string literal
 *    can never produce invalid JSON (quotes, newlines, backslashes).
 *  - 'url':  values are encodeURIComponent-encoded for use inside URLs.
 */
export const applyWebhookTemplate = (template: string, vars: Record<string, unknown>, mode: 'json' | 'url'): string => {
  if (!template.includes('{{')) {
    return template;
  }

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) {
      return '';
    }
    const stringValue = typeof value === 'string' ? value : String(value);
    if (mode === 'url') {
      return encodeURIComponent(stringValue);
    }
    // JSON.stringify adds surrounding quotes — strip them, keep the escapes.
    return JSON.stringify(stringValue).slice(1, -1);
  });
};
