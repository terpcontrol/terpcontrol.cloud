import i18n from 'i18next';
import type { Device, DevicePage } from '@fg2/shared-types/v1';
import { API_URL, APP_VERSION, BUILD_MODE } from '@/api/config';
import { queryClient } from '@/api/query-client';
import { session } from '@/api/session';

/**
 * What a feedback report says about where it was sent from, so that a bug arrives with the account, the page and the
 * hardware it is about rather than with a question back.
 *
 * BugDrop asks a global function named in its tag (`data-prefill-provider`) for the text the description starts
 * with, at the moment the form opens. The context goes in there - under the reporter's own words, in plain sight and
 * editable - rather than anywhere hidden: the issue is public, so the reporter sees everything it will say and can
 * strike what they do not want to share. BugDrop adds the browser, the viewport and the address without its query on
 * its own; this adds what only the app knows.
 */
export const PREFILL_PROVIDER = 'terpcontrolFeedback';

/** Where the app is: the address and the ids the matched routes read from it. */
export interface FeedbackScene {
  pathname: string;
  search: string;
  params: Record<string, string | undefined>;
}

/**
 * Parts of an address that open something on their own - a share link, a password reset, an invitation - and must
 * not end up in a public issue. The button is only drawn inside the signed-in shell, where none of them occur; this
 * keeps it that way if it ever is not.
 */
const SECRET = new Set(['token', 'code', 'recovery', 'share']);

/** The route ids worth naming, in the order they are listed. */
const PARAMS: [key: string, label: string][] = [
  ['spaceId', 'place'],
  ['growId', 'grow'],
  ['plantId', 'plant'],
  ['deviceId', 'device'],
  ['cameraId', 'camera'],
];

const addressOf = ({ pathname, search, params }: FeedbackScene): string => {
  let path = pathname;
  for (const key of SECRET) {
    const value = params[key];
    if (value) path = path.replace(value, '…');
  }
  const query = new URLSearchParams(search);
  for (const key of [...query.keys()]) if (SECRET.has(key)) query.set(key, '…');
  const rest = query.toString();

  return rest ? `${path}?${decodeURIComponent(rest)}` : path;
};

/** One device as a line: its id, what it is, and what it runs and last said, which is most of a first question. */
const deviceLine = (device: Device): string =>
  [
    device.id,
    device.type,
    device.state.firmwareId ? `fw ${device.state.firmwareId}` : 'fw unknown',
    `channel ${device.firmware.channel}`,
    device.state.lastSeenAt ? `seen ${device.state.lastSeenAt}` : 'never seen',
  ].join(' · ');

/**
 * The devices the page is about: the one in the address, or every device of the place in it. Read from what the app
 * already holds, never asked for - opening the form must not wait on the network, and BugDrop wants the text at once.
 */
const devicesOf = (scene: FeedbackScene, cached: Device[]): Device[] => {
  const deviceId = scene.params.deviceId;
  if (deviceId) return cached.filter(device => device.id === deviceId);
  const spaceId = scene.params.spaceId ?? new URLSearchParams(scene.search).get('space');

  return spaceId ? cached.filter(device => device.spaceId === spaceId) : [];
};

/** The debug lines, worked out from the scene, the session and the cache alone. */
export const debugLines = (scene: FeedbackScene, cached: Device[] = []): string[] => {
  const { user } = session.snapshot();
  const query = new URLSearchParams(scene.search);
  const ids = PARAMS.flatMap(([key, label]) => (scene.params[key] ? [`- ${label}: ${scene.params[key]}`] : []));
  // Verlauf, Steuerung and Charts carry the place and the grow in the query rather than the path.
  for (const [key, label] of [
    ['space', 'place'],
    ['grow', 'grow'],
  ] as const)
    if (query.get(key) && !scene.params[`${key}Id`]) ids.push(`- ${label}: ${query.get(key)}`);

  return [
    `- user: ${user ? [user.id, `@${user.handle}`, user.isAdmin ? 'admin' : null, user.isDemo ? 'demo' : null].filter(Boolean).join(' · ') : 'not signed in'}`,
    `- page: ${addressOf(scene)}`,
    ...ids,
    ...devicesOf(scene, cached).map(device => `- device: ${deviceLine(device)}`),
    `- app: v${APP_VERSION} · ${BUILD_MODE} · api ${new URL(API_URL).host}`,
    `- language: ${i18n.resolvedLanguage ?? i18n.language} · browser zone ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
  ];
};

/**
 * What the form's description starts with: room for the reporter's words, then the context under a heading. Not under
 * a `---` rule: BugDrop trims the leading blank lines, and a `---` straight under the reporter's line turns that line
 * into a heading on GitHub.
 */
export const prefillFor = (scene: FeedbackScene): { descriptionTemplates: Record<'bug' | 'feature' | 'question', string> } => {
  const cached = queryClient.getQueryData<DevicePage>(['devices'])?.items ?? [];
  const text = ['', '', `#### ${i18n.t('shell.feedbackContext')}`, ...debugLines(scene, cached)].join('\n');

  return { descriptionTemplates: { bug: text, feature: text, question: text } };
};

declare global {
  interface Window {
    [PREFILL_PROVIDER]?: () => ReturnType<typeof prefillFor>;
  }
}

/** Hands BugDrop the provider its tag names; `read` says where the app is at the moment the form opens. */
export const provideFeedbackContext = (read: () => FeedbackScene): void => {
  window[PREFILL_PROVIDER] = () => prefillFor(read());
};
