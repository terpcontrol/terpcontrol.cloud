import type { Session } from '@fg2/shared-types/v1';

/**
 * A session's user agent, read into the two words a person can recognise a
 * browser by. Nothing more is read into it: a user agent is a string the
 * client chose, and what it says about itself is all this can honestly repeat.
 * A string that names no browser and no system is shown as it came, and a
 * session that reported none is answered null so the screen can say so.
 */
export const deviceLabel = (userAgent: string | null): string | null => {
  if (!userAgent) return null;
  const parts = [browserOf(userAgent), systemOf(userAgent)].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(' · ') : userAgent;
};

/** The order matters: every Chromium browser also says "Chrome", and Chrome also says "Safari". */
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\//, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bHeadlessChrome\//, 'Headless Chrome'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bVersion\/.*\bSafari\//, 'Safari'],
  [/^curl\//, 'curl'],
];

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b|\biPod\b/, 'iOS'],
  [/\biPad\b/, 'iPadOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

const browserOf = (userAgent: string): string | null => BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;

const systemOf = (userAgent: string): string | null => SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;

/**
 * This device first, so that the one row that cannot be revoked is where the
 * eye lands; the rest by when they were last used, because the browser
 * nobody has touched for a month is the one worth signing out.
 */
export const sortedSessions = (sessions: Session[], currentId: string | null): Session[] =>
  [...sessions].sort((one, other) => {
    if (one.id === currentId) return -1;
    if (other.id === currentId) return 1;

    return Date.parse(other.lastSeenAt) - Date.parse(one.lastSeenAt);
  });
