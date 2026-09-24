import { DateTime, Settings } from 'luxon';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dayOf, startOfDayOn } from '@/ui/days';
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

/** Every source file of the app, which is what each of the sweeps below reads. */
const files = (from: string): string[] =>
  readdirSync(resolve(process.cwd(), from), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(`${from}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${from}/${entry.name}`] : [],
  );

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
 * Every file that writes an hour of the day or a date, and the one way in.
 *
 * A format holding an hour token is a clock time whoever wrote it; Luxon's
 * `TIME_SIMPLE` and its relatives are one as well, and follow the language the
 * app is being read in rather than the account's zone, which is how one mute
 * came to be "11:38" on one screen and "11:38 AM" on the next. Either way the
 * file has to go through `ui/zone`, which is where both the zone and the shape
 * are decided.
 *
 * A date is the same thing and was left out of this for a whole pass. Which
 * day an instant falls on is a day boundary read off it, and a grow that ended
 * at 22:31 UTC ended on the following day to a reader nine hours east - so the
 * archive dated two of this account's grows a day out for anybody reading from
 * Tokyo, and nothing here objected because the format held no hour. The shape
 * went the same way: four screens under Me reached for `DATE_MED`, which
 * resolves through the language and printed the American order beside an
 * archive printing the British one. So a day or month token counts exactly as
 * an hour token does, and so does a locale preset of either kind.
 *
 * The check is deliberately blunt: it does not prove the zone reaches the
 * right instant, only that a file cannot have drawn an hour or a date without
 * meeting the rule. That is enough to stop the thing that actually happens,
 * which is a new screen reaching for `DateTime.fromISO(x).toFormat('HH:mm')`
 * because it reads like the obvious way to write one.
 */
describe('every clock time and every date the app writes', () => {
  /** Only a format string: letters, digits and the punctuation a Luxon format is built from. */
  const FORMAT = /^[A-Za-z0-9\s:.,/'-]+$/;

  /**
   * An hour token, standing on its own rather than inside a word. A single `h`
   * is left out on purpose: it is the unit somebody writes beside a duration
   * far more often than it is a format.
   */
  const HOUR = /(?<![A-Za-z])(HH|hh|[Hh]:mm)(?![A-Za-z])/;

  /**
   * A day, month, year or weekday token, standing on its own rather than
   * inside a word.
   *
   * A single `d`, `M` or `L` is left out on purpose and for the same reason a
   * single `h` is: those three letters are an SVG path's move-and-line
   * commands and the tail of a window named "7d", and every one of those
   * appears in this app as a plain string. Every real date format here spells
   * at least one token in full - "d LLL yyyy", "dd.MM", "ccc d LLL" - so the
   * two-letter and three-letter forms are enough to find one without calling
   * a chart's path a date.
   */
  const DATE = /(?<![A-Za-z])(yyyy|yy|LLLL|LLL|LL|MMMM|MMM|MM|dd|EEEE|EEE|cccc|ccc)(?![A-Za-z])/;

  /**
   * Luxon's own formats, which are the reader's language and not the account's
   * zone. `TIME_SIMPLE` put an "11:38 AM" beside another screen's "11:38";
   * `DATE_MED` put an "Oct 23, 2026" beside another screen's "24 Aug 2026",
   * because Luxon's English resolves to the American order.
   */
  const PRESET = /DateTime\.(TIME_|DATE_|DATETIME_)[A-Z_]+/;

  /**
   * Writing a date through the reader's locale without naming a preset, which
   * is the same bypass with the shape spelled out by hand.
   */
  const LOCALE_SHAPED = /\.toLocaleString\(/;

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
  const BORROWED = /\b(STAMPS|CLOCK|DATED_CLOCK|DAY|DAY_IN_YEAR|NARROW_DAY|WEEKDAY_DAY)\b|DateTime\.fromMillis\(/;

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

  /**
   * Two files that write a date in the browser's zone and are not fixed here.
   *
   * Both are the plain bypass this sweep exists to catch - `CameraSettings`
   * dates a camera's entitlement and `members/invites` an invitation's expiry,
   * each with `DateTime.fromISO(...).toFormat(...)` and no zone - and both are
   * open in front of another pass over the same defect, where two passes
   * editing one file is a conflict rather than a fix. This is a debt and not a
   * reason, which is why the check below insists each entry is still an
   * offender: the entry has to be deleted by whoever fixes the file, or the
   * suite fails asking why it is still here.
   */
  const NOT_YET = ['src/screens/camera/CameraSettings.tsx', 'src/screens/space/members/invites.ts'];

  /** Every single-quoted literal in a file that could be a Luxon format. */
  const formatsIn = (source: string): string[] =>
    [...source.matchAll(/'([^'\n\\]*)'/g)].map(match => match[1]).filter(literal => FORMAT.test(literal));

  /** Whether this file writes a moment at all - an hour, a date, or one of the shared formats that carry either. */
  const writesAMoment = (source: string): boolean =>
    PRESET.test(source) ||
    LOCALE_SHAPED.test(source) ||
    BORROWED.test(source) ||
    formatsIn(source).some(literal => HOUR.test(literal) || DATE.test(literal));

  const bypasses = (path: string): boolean => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');

    return writesAMoment(source) && !ZONE_IMPORT.test(source);
  };

  it('goes through the account´s zone, or says in the list here why it does not', () => {
    const offenders = files('src')
      .filter(path => !EXEMPT.some(exempt => path.startsWith(exempt)) && !NOT_YET.includes(path))
      .filter(bypasses);

    expect(offenders).toEqual([]);
  });

  it('still owes the zone to the two files another pass is holding, and will say so until they are fixed', () => {
    expect(NOT_YET.filter(bypasses)).toEqual(NOT_YET);
  });

  it('never reaches for a locale preset, which writes "11:38 AM" and "Oct 23, 2026" beside another screen´s "11:38" and "24 Aug 2026"', () => {
    const using = files('src').filter(path => PRESET.test(readFileSync(resolve(process.cwd(), path), 'utf8')));

    expect(using).toEqual([]);
  });
});

/**
 * The calendar a day is read on and the calendar it is written back on, which
 * have to be one calendar.
 *
 * This is the shape none of the sweeps above can see, and it is worth saying
 * plainly why. Each of them asks a question about one line: does this file go
 * through the rule, does it reach for a preset, does it read a field off a
 * `Date`. The reminder sheet passed every one of them while being wrong,
 * because its two halves were wrong only about each other: it read the day a
 * one-off falls on with `dayOf(new Date(reminder.onceAt), null)` - the reader's
 * own calendar, which `ui/days` documents as a thing a caller may ask for - and
 * wrote it back as the start of that day where the account is. Both halves are
 * defensible alone. Together they are not a round trip: opened by anybody
 * behind their account the field offered the day before the one the reminder
 * falls on, and a Save that changed nothing filed it there, one day earlier
 * every time it was saved.
 *
 * What a sweep can see is the `null`. A zone that is `null` because the account
 * has not answered yet is a value arriving through `useZone`; a `null` spelled
 * into the call is a screen deciding that this particular day belongs to
 * whoever is reading rather than to whoever the day is about - and the day a
 * task falls due, the day a line was written, the day a field is showing are
 * all the account's. So no screen spells it, and the two halves of a date field
 * are told the same zone because there is only one zone to tell them.
 *
 * That is not the whole of it: a file could still hand one half the account's
 * zone and the other half a different account's, and no reading of the source
 * would notice. What covers that is the round trip being asserted rather than
 * inspected - below, and again in `tasks.test.tsx`, where the sheet itself is
 * opened and saved untouched.
 */
describe('the zone a day is read in and written back in', () => {
  /**
   * A day or an hour asked for on the reader's own calendar by name. The
   * argument may hold a call of its own - `dayOf(serverNow().toJSDate(), null)`
   * was one of the two lines this was written for - so one nesting is allowed
   * inside it.
   */
  const READS_THE_READER = /\b(clock|datedClock|calendarDay|zoned|zonedAt|nowThere|dayOf|momentOn|startOfDayOn)\((?:[^()]|\([^()]*\))*,\s*null\s*\)/;

  /**
   * Where the reader's own calendar is the right answer, with the reason.
   *
   * `ui/zone.ts` and `ui/days.ts` are the rule itself, and both spell the
   * fallback they offer. The public surfaces are read by strangers with no
   * account here, so the day a diary line falls on is theirs to read where they
   * are - which is the same exemption the sweep above gives them.
   */
  const EXEMPT = ['src/ui/zone.ts', 'src/ui/days.ts', 'src/screens/public/'];

  const asksForTheReadersCalendar = (path: string): boolean => READS_THE_READER.test(readFileSync(resolve(process.cwd(), path), 'utf8'));

  it('is the account´s on both halves, because a field that reads a day on one calendar and writes it on another loses one', () => {
    const offenders = files('src')
      .filter(path => !EXEMPT.some(exempt => path.startsWith(exempt)))
      .filter(asksForTheReadersCalendar);

    expect(offenders).toEqual([]);
  });
});

/**
 * The round trip itself, which is the half of this no sweep can read.
 *
 * A reminder falls due at the start of its day where the account is. Opening
 * the sheet reads that instant back as a day and saving it starts that day
 * again, so the pair has to be the identity - and it is the identity only when
 * both ends are told the same zone. The reader's own zone is moved about
 * underneath them here, because the defect was invisible from anywhere east of
 * the account and every browser in the app's own tests happens to sit there.
 */
describe('a day read back and written again', () => {
  /** A reader ahead of the account, one behind it, and one in it - the third is where this used to be tested and where it never failed. */
  const BROWSERS = ['Asia/Tokyo', 'America/Los_Angeles', 'UTC'];
  const ACCOUNTS = ['UTC', 'Europe/Berlin', 'Pacific/Auckland', 'America/Los_Angeles'];

  const inBrowser = (zone: string, read: () => void): void => {
    Settings.defaultZone = zone;
    try {
      read();
    } finally {
      Settings.defaultZone = 'system';
    }
  };

  it('is the day it started as, wherever the reader is sitting', () => {
    for (const browser of BROWSERS) {
      inBrowser(browser, () => {
        for (const account of ACCOUNTS) {
          const due = DateTime.fromISO('2026-09-30T12:00:00.000Z').setZone(account).startOf('day').toJSDate();

          expect(startOfDayOn(dayOf(due, account), account)).toEqual(due);
        }
      });
    }
  });

  it('moves a whole day when the two ends are told different zones, which is what it looked like from Los Angeles', () => {
    inBrowser('America/Los_Angeles', () => {
      const due = new Date('2026-09-30T00:00:00.000Z');

      // The pair the reminder sheet had: the day read where the reader is, the
      // day started where the account is. Both halves plausible, a day apart.
      expect(dayOf(due, null)).toBe('2026-09-29');
      expect(startOfDayOn(dayOf(due, null), 'UTC')).not.toEqual(due);
      expect(startOfDayOn(dayOf(due, 'UTC'), 'UTC')).toEqual(due);
    });
  });
});

/**
 * The two bypasses that are not a format string at all.
 *
 * Everything above looks for a shape being written, which is why a whole pass
 * of both rules went by with five screens still breaking them: what those five
 * reached for was the browser's `Date`, and a `Date` spells nothing. The grow
 * page aged its freshness line off `new Date(query.dataUpdatedAt)`, which is a
 * millisecond this browser noted measured against the server's now - a laptop
 * three quarters of an hour slow was told a read that had just landed was
 * three quarters of an hour old, and one running fast was told "0 s ago" for
 * ever, because an age below zero is clamped. And the sheets that record
 * something after the fact read their day with `getFullYear`/`getMonth`/
 * `getDate` and wrote it back with `setFullYear`, which is the browser's
 * calendar and not the account's: a grower east of their account picked the day
 * their tent stood through and filed the line a grow day early.
 *
 * So there are two more sweeps here. Neither can see what a file means by the
 * instant it makes, and neither tries to: the first says that a file minting an
 * instant of its own has to have met `api/clock`, and the second that nothing
 * reads a calendar field off a `Date`, because Luxon and `ui/zone` are how a
 * day boundary is asked for.
 */
describe('every instant the app makes for itself', () => {
  /**
   * The browser's own clock, and the two ways an instant is minted from it: a
   * `Date` or a `Date.now()` with nothing to read but the machine's idea of the
   * hour, and an ISO instant written out of one. `new Date(someInstant)` is not
   * here - parsing an instant the server sent is not reading a clock.
   */
  const BROWSER_CLOCK = /new Date\(\s*\)|Date\.now\(\s*\)|\.toISOString\(\)/;

  const CLOCK_IMPORT = /from '(@\/api\/clock|\.\/clock|\.\.\/clock|\.\.\/api\/clock)'/;

  /**
   * Where the browser's clock is the right answer, with the reason.
   *
   * `api/clock.ts` is the rule itself, and `api/client.ts` is where the offset
   * is learned - both hold a pair of the browser's own instants on purpose. The
   * undo window is the same thing: the queue stamps `Date.now() + 5s` and the
   * toast counts down to it, so the two are a stopwatch measured wholly on one
   * clock, and the server's opinion of the hour would not improve it.
   */
  const EXEMPT = ['src/api/clock.ts', 'src/api/client.ts', 'src/log/LogProvider.tsx', 'src/log/Toasts.tsx'];

  /**
   * One sheet that opens its backdating field on the browser's own now, and is
   * not fixed here: the new-grow sheet is open in front of another pass, where
   * two passes editing one file is a conflict rather than a fix. A debt and not
   * a reason, so the check below insists it is still an offender - whoever
   * fixes the file deletes the entry, or the suite fails asking why it is here.
   */
  const NOT_YET = ['src/screens/grow/new/NewGrowSheet.tsx'];

  const mintsAnInstant = (path: string): boolean => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');

    return BROWSER_CLOCK.test(source) && !CLOCK_IMPORT.test(source);
  };

  it('reads the server´s clock for it, or says in the list here why the browser´s is the right one', () => {
    const offenders = files('src')
      .filter(path => !EXEMPT.includes(path) && !NOT_YET.includes(path))
      .filter(mintsAnInstant);

    expect(offenders).toEqual([]);
  });

  it('still owes the clock to the sheet another pass is holding, and will say so until it is fixed', () => {
    expect(NOT_YET.filter(mintsAnInstant)).toEqual(NOT_YET);
  });
});

describe('every day the app reads off a Date', () => {
  /**
   * A calendar field of a `Date`, read or written. Every one of these is the
   * browser's own zone with no way to ask for another, so a day, a month or an
   * hour taken off one is a day boundary decided where the reader happens to be
   * sitting. `getTime` is not among them: milliseconds are an instant, and an
   * instant is the same everywhere.
   */
  const BROWSER_CALENDAR = /\.(get|set)(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\(/;

  /** Nothing yet. A day is asked for through `ui/zone`, which is told which zone to read it in. */
  const EXEMPT: string[] = [];

  const readsTheBrowsersCalendar = (path: string): boolean => BROWSER_CALENDAR.test(readFileSync(resolve(process.cwd(), path), 'utf8'));

  it('asks Luxon and the account´s zone for it, because a day begins where the account is', () => {
    const offenders = files('src')
      .filter(path => !EXEMPT.includes(path))
      .filter(readsTheBrowsersCalendar);

    expect(offenders).toEqual([]);
  });
});
