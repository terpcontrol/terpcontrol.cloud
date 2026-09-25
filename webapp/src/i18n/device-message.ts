import type { i18n as I18n } from 'i18next';
import type { Entry, EntryMessage } from '@fg2/shared-types/v1';
import { alarmLineText } from './alarm-line';

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

const ALARM_LINES = new Set(['message-alarm-triggered', 'message-alarm-resolved']);

/**
 * The lines the server writes about a firmware update name the build before
 * and the build after as `<before> -> <after>`, with "unknown" for a build the
 * cloud never learnt. Both halves are written for a reader: the arrow the app
 * uses everywhere else, and the unknown build in the reader's words.
 */
const BUILD_CHANGES = new Set(['message-firmware-update-complete-with-ids', 'message-firmware-update-failed-with-ids']);

const buildChange = (i18n: I18n, value: string): string =>
  value
    .split(' -> ')
    .map(build => (build === 'unknown' ? i18n.t('deviceLine.unknownBuild') : build))
    .join(' → ');

export const resolveDeviceMessage = (i18n: I18n, message: EntryMessage, part: MessagePart): string => {
  const value = message.params.join(':');

  // An alarm's line carries the reading in English prose; it is read back into
  // its parts and written in the reader's words (see `alarmLineText`).
  if (part === 'text' && ALARM_LINES.has(message.key) && message.params.length === 1) {
    const said = alarmLineText(i18n, message.params[0], message.key === 'message-alarm-triggered');
    if (said !== null) return said;
  }

  const specific = value ? `${message.key}:${value}-${part}` : null;
  if (specific && i18n.exists(specific)) return i18n.t(specific);

  const generic = `${message.key}-${part}`;
  if (i18n.exists(generic)) return i18n.t(generic, { value: BUILD_CHANGES.has(message.key) ? buildChange(i18n, value) : value });

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

/** What the migration joined a title and a body with, and what cuts them apart again. */
const PARAGRAPH = '\n\n';

/**
 * A machine's line that came over with no key, cut back into the two things it
 * is: what it was called, and what it said.
 *
 * The old app let a device line carry a free-form title, and the migration kept
 * it - a title nobody has a translation for is still what the row is about -
 * by joining it to the body with a blank line, since neither can be recovered
 * from the other afterwards. Without this, the whole of that goes into the
 * headline, `white-space: pre-line` draws the blank line, and a row that should
 * be a title over a detail is three lines with its own title at the top of two
 * of them: 38,228 of the 68,023 unkeyed machine lines in the restored database
 * carry a body that begins with their own title, 138 of one fridge's 253 alarm
 * rows among them, beside keyed rows on the same screen that draw correctly.
 *
 * The repeat is stripped only where the body is the title followed by a colon,
 * which is the shape every one of those 38,228 has and the only one that can be
 * taken off without maiming a sentence that merely starts with the same word.
 * Only the first blank line is cut at: 48 rows have more than one, and what
 * follows is the body speaking rather than a third thing.
 */
export const machineLineParts = (entry: EntryWords): { headline: string; detail: string | null } | null => {
  if (entry.message || ownWords(entry) || !entry.text) return null;

  const blank = entry.text.indexOf(PARAGRAPH);
  if (blank < 0) return null;

  const headline = entry.text.slice(0, blank);
  const body = entry.text.slice(blank + PARAGRAPH.length);
  const said = body.startsWith(`${headline}:`) ? body.slice(headline.length + 1).trimStart() : body;

  return { headline, detail: said.length > 0 ? said : null };
};

/**
 * What a timeline row says. A person's own words are never translated; a
 * device's, a plan's and an alarm's always are.
 */
export const entryHeadline = (i18n: I18n, entry: EntryWords): string =>
  machineLineParts(entry)?.headline ?? ownWords(entry) ?? (entry.message ? resolveDeviceMessage(i18n, entry.message, 'title') : (entry.text ?? ''));

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
 * twice. A key whose two halves resolve alike says it once. And the marks that
 * stand for a line written somewhere else say what they are in their title, so
 * their text is that title at greater length - "A line written in the diary of
 * the plants." is all `message-diary-plant-log-text` has to add to a mark that
 * already reads "Plant log entry". Those are named, because there is no other
 * way to know it: they are the only keys whose text says nothing the title has
 * not, and `message-ext-sensor-fail` is among them although its two halves are
 * not string-equal.
 *
 * Carrying no parameters is not the test, though it stood in for one until a
 * real account showed what it costs. Four device messages state what to do
 * about them in the text and nothing in the title - "Please check your internet
 * connection or wifi", "check your power connection", "Check sensor placement!",
 * "Check your CO2 bottle!" - and none of them takes a parameter, so the advice
 * reached no screen at all on seventy thousand of this account's lines.
 *
 * A migrated line with no key at all has its two halves in `text` rather than
 * in a catalogue, so it is cut apart rather than looked up - the same two
 * things, told apart the only way that row can be.
 */
/**
 * The keys whose text is their title said at greater length, so that a row
 * drawing both would say one thing twice. They are the marks a diary line
 * leaves behind rather than anything a device has to report, with the sensor
 * failure beside them because its two halves differ by a word and an
 * exclamation mark and would otherwise slip past the equality test below.
 */
const RESTATES_THE_MARK = new Set([
  'message-diary-co2-refill',
  'message-diary-fridge-log',
  'message-diary-measurement',
  'message-diary-plant-lifecycle',
  'message-diary-plant-log',
  'message-ext-sensor-fail',
]);

export const entryDetail = (i18n: I18n, entry: EntryWords): string | null => {
  const migrated = machineLineParts(entry);
  if (migrated) return migrated.detail;

  if (ownWords(entry) || !entry.message || RESTATES_THE_MARK.has(entry.message.key)) return null;

  const detail = entryBody(i18n, entry);
  return detail === entryHeadline(i18n, entry) ? null : detail;
};
