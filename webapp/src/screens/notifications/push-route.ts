import type { PushPayload as ContractPushPayload } from '@fg2/shared-types/v1';

/**
 * What a push says and where a tap on it lands.
 *
 * The service worker is the one part of the app no test can render, so the two
 * decisions it makes about a push - what the body actually contained, and which
 * screen the person wanted when they tapped it - are made here instead, where
 * they can be checked without a browser.
 */

/** What the server encodes into a push, in the contract's shape; a push with a body that is not one still shows something. */
export type PushPayload = Partial<ContractPushPayload>;

/** A push whose body is missing or is not the contract's JSON is still a push worth showing, so it reads as an empty one. */
export const payloadOf = (data: { json: () => unknown } | null | undefined): PushPayload => {
  try {
    return (data?.json() as PushPayload | null) ?? {};
  } catch {
    return {};
  }
};

/** Where a tap on the notification lands, by what it is about: the inbox for an alarm, the list for a task. */
export const pathOf = (subject: PushPayload['subject']): string => {
  if (subject?.type === 'alert') return '/alerts';
  if (subject?.type === 'task') return '/tasks';
  return '/';
};
