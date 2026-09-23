import { DateTime } from 'luxon';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clock, CLOCK, datedClock, nowThere, zoned, zonedAt } from '@/ui/zone';

/**
 * The zone a clock time is drawn in, and the sweep that keeps it that way.
 *
 * The account names a zone, the server means it - quiet hours are read there -
 * and a time drawn in the browser's zone is simply a different time. Three
 * screens were converted when the rule was written and the rest were left
 * behind, which is how one alert came to be dated "since 00:20" on the inbox
 * and "12:20" in the diary of the same app. So there is a check here that
 * fails when a new screen writes a clock time without going through the rule,
 * because the next screen will be written by somebody who never read this.
 */

describe('the zone an instant is read in', () => {
  it('reads an instant where the account is, and leaves it where the browser is until the account answers', () => {
    expect(clock('2026-09-23T00:07:59.159Z', 'UTC')).toBe('00:07');
    expect(clock('2026-09-23T00:07:59.159Z', 'Europe/Berlin')).toBe('02:07');
    expect(clock('2026-09-23T00:07:59.159Z', null)).toBe(DateTime.fromISO('2026-09-23T00:07:59.159Z').toFormat(CLOCK));
  });

  it('names the day as well where the instant is not today´s, which a bare hour would read as already past', () => {
    expect(datedClock('2026-09-23T22:38:00.000Z', 'Pacific/Kiritimati')).toBe('24 Sep 12:38');
  });

  it('reads a moment held as milliseconds the same way, which is how the timeline and the camera carry one', () => {
    const at = DateTime.fromISO('2026-09-23T00:07:59.159Z').toMillis();

    expect(zonedAt(at, 'Asia/Tokyo').toFormat(CLOCK)).toBe('09:07');
    expect(zonedAt(at, null).toFormat(CLOCK)).toBe(DateTime.fromMillis(at).toFormat(CLOCK));
  });

  it('moves "now" into the same zone, so that a day is not compared against another zone´s day', () => {
    // Luxon reads `hasSame` in the zone of the argument, so an instant moved on
    // its own and compared with an unmoved now is filed under the wrong day.
    const at = zoned('2026-09-23T09:00:00.000Z', 'Pacific/Kiritimati');
    const now = DateTime.fromISO('2026-09-23T23:40:00.000Z');

    expect(at.hasSame(nowThere(now, 'Pacific/Kiritimati'), 'day')).toBe(false);
    expect(at.hasSame(nowThere(now, 'UTC'), 'day')).toBe(true);
  });
});

/**
 * Every file that writes an hour of the day, and the one way in.
 *
 * A format holding an hour token is a clock time whoever wrote it; Luxon's
 * `TIME_SIMPLE` and its relatives are one as well, and follow the language the
 * app is being read in rather than the account's zone, which is how one mute
 * came to be "11:38" on one screen and "11:38 AM" on the next. Either way the
 * file has to go through `ui/zone`, which is where both the zone and the shape
 * are decided.
 *
 * The check is deliberately blunt: it does not prove the zone reaches the
 * right instant, only that a file cannot have drawn an hour without meeting
 * the rule. That is enough to stop the thing that actually happens, which is a
 * new screen reaching for `DateTime.fromISO(x).toFormat('HH:mm')` because it
 * reads like the obvious way to write one.
 */
describe('every clock time the app writes', () => {
  /** Only a format string: letters, digits and the punctuation a Luxon format is built from. */
  const FORMAT = /^[A-Za-z0-9\s:.,/'-]+$/;

  /**
   * An hour token, standing on its own rather than inside a word. A single `h`
   * is left out on purpose: it is the unit somebody writes beside a duration
   * far more often than it is a format.
   */
  const HOUR = /(?<![A-Za-z])(HH|hh|[Hh]:mm)(?![A-Za-z])/;

  /** Luxon's own time formats, which are the reader's language and not the account's zone. */
  const PRESET = /DateTime\.(TIME_|DATETIME_)[A-Z_]+/;

  /**
   * Writing an hour without spelling one, which is how the whole Charts screen
   * got past the check above.
   *
   * That screen contained no format string at all: it imported `STAMPS` from
   * the timeline and handed each one to Luxon as a value, and wrote the export's
   * instants with `DateTime.fromMillis(...).toISO()`. Every clock time on it was
   * therefore the browser's, on an app that had moved onto the account's zone a
   * screen at a time, and nothing here objected because the hour was spelled a
   * directory away.
   *
   * So the shared formats that carry an hour count wherever they are used, and
   * so does building a moment out of the milliseconds this app carries a cursor
   * and a chart's x in - a number of milliseconds is always an instant here,
   * never a bare date, so there is no zone-free reason to reach for one.
   */
  const BORROWED = /\b(STAMPS|CLOCK|DATED_CLOCK)\b|DateTime\.fromMillis\(/;

  const ZONE_IMPORT = /from '(@\/ui\/zone|\.\/zone|\.\.\/zone|\.\.\/\.\.\/ui\/zone)'/;

  /**
   * Where the browser's zone is the right answer, with the reason.
   *
   * `ui/zone.ts` is the rule itself. The public surfaces are read by strangers
   * who have no account here at all, and the zone the diary they are reading
   * was written in is not part of what the public API answers about somebody
   * else's account - so those pages keep the clock of whoever is reading them.
   * `api/clock.ts` writes no time for anybody to read: it stamps an instant the
   * way the server would have, in UTC, so that an age is a subtraction of two
   * instants on one clock.
   */
  const EXEMPT = ['src/ui/zone.ts', 'src/screens/public/', 'src/api/clock.ts'];

  const files = (from: string): string[] =>
    readdirSync(resolve(process.cwd(), from), { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? files(`${from}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${from}/${entry.name}`] : [],
    );

  /** Every single-quoted literal in a file that could be a Luxon format. */
  const formatsIn = (source: string): string[] =>
    [...source.matchAll(/'([^'\n\\]*)'/g)].map(match => match[1]).filter(literal => FORMAT.test(literal));

  it('goes through the account´s zone, or says in the list here why it does not', () => {
    const offenders = files('src')
      .filter(path => !EXEMPT.some(exempt => path.startsWith(exempt)))
      .filter(path => {
        const source = readFileSync(resolve(process.cwd(), path), 'utf8');
        const writesAnHour = PRESET.test(source) || BORROWED.test(source) || formatsIn(source).some(literal => HOUR.test(literal));

        return writesAnHour && !ZONE_IMPORT.test(source);
      });

    expect(offenders).toEqual([]);
  });

  it('never reaches for a locale preset, which writes "11:38 AM" beside another screen´s "11:38"', () => {
    const using = files('src').filter(path => PRESET.test(readFileSync(resolve(process.cwd(), path), 'utf8')));

    expect(using).toEqual([]);
  });
});
