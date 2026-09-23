import type { i18n as I18n } from 'i18next';
import type { Entry, EntryMessage } from '@fg2/shared-types/v1';

/**
 * A device does not write sentences; it writes keys. The server parses a log
 * line into `{ key, params }` at the boundary, and the words are the ones that
 * have been in `assets/i18n/*.json` all along - `message-co2-low-text`,
 * `message-device-booted:POWERON-title`.
 *
 * Two lookups, because the catalogue answers a key two ways: the reason may be
 * spelled out (`<key>:<param>-<suffix>`), or the generic wording takes the
 * parameter as `{{value}}` (`<key>-<suffix>`). What has neither is shown as it
 * came, so a key a newer firmware invents is readable before it is translated.
 */

export type MessagePart = 'title' | 'text';

export const resolveDeviceMessage = (i18n: I18n, message: EntryMessage, part: MessagePart): string => {
  const value = message.params.join(':');

  const specific = value ? `${message.key}:${value}-${part}` : null;
  if (specific && i18n.exists(specific)) return i18n.t(specific);

  const generic = `${message.key}-${part}`;
  if (i18n.exists(generic)) return i18n.t(generic, { value });

  return value ? `${message.key}:${value}` : message.key;
};

/** As much of an entry as it takes to say what it says. */
type EntryWords = Pick<Entry, 'source' | 'text' | 'message'>;

/**
 * What somebody wrote themselves, where they wrote anything.
 *
 * A line can carry both: the migration keeps the old app's own label for a
 * diary line in `message` and whatever was typed under it in `text`, because
 * neither can be recovered from the other afterwards. The words win. A slug
 * title says the kind of thing that was done, which the row's own mark already
 * says, while the sentence a grower typed about their grow exists nowhere else
 * and is the reason the line was written at all.
 */
const ownWords = (entry: EntryWords): string | null => (entry.source === 'human' && entry.text ? entry.text : null);

/**
 * What a timeline row says. A person's own words are never translated; a
 * device's, a plan's and an alarm's always are.
 */
export const entryHeadline = (i18n: I18n, entry: EntryWords): string =>
  ownWords(entry) ?? (entry.message ? resolveDeviceMessage(i18n, entry.message, 'title') : (entry.text ?? ''));

export const entryBody = (i18n: I18n, entry: EntryWords): string =>
  ownWords(entry) ?? (entry.message ? resolveDeviceMessage(i18n, entry.message, 'text') : (entry.text ?? ''));

/**
 * What a machine's line actually said, under the kind of thing it was - or
 * nothing, where the headline is already the whole of it.
 *
 * A device, the plan and an alarm write a key and the parameters that make it
 * one event rather than a category, and the catalogue words both halves: the
 * title of `message-alarm-triggered` is "Alarm triggered" for every alarm ever
 * raised, while its text is the reading, both thresholds and the extreme that
 * tripped it. Drawing the title alone turns four different alarms of one night
 * into one label repeated four times, and there is no screen behind the line to
 * ask - so the parameters are drawn here rather than thrown away.
 *
 * Three things keep this from being noise rather than detail. A line somebody
 * typed has none: their words are already the headline, `entryBody` falls back
 * to the same words, and a phase line carrying a typed paragraph would print it
 * twice. A message with no parameters has none either - its text is its title
 * said again at greater length, which is all `message-diary-plant-log-text`
 * ("A line written in the diary of the plants.") has to add to a mark that
 * already says so. And a key whose two halves resolve alike says it once.
 */
export const entryDetail = (i18n: I18n, entry: EntryWords): string | null => {
  if (ownWords(entry) || !entry.message || entry.message.params.length === 0) return null;

  const detail = entryBody(i18n, entry);
  return detail === entryHeadline(i18n, entry) ? null : detail;
};
