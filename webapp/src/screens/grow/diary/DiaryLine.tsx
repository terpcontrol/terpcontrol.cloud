import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Person, Plant, ReadingName } from '@fg2/shared-types/v1';
import { useDevicesShape } from '@/api/devices';
import { sinceLabel } from '@/ui/age';
import { warningOf } from '@/ui/entries';
import { EntryWords } from '@/ui/EntryWords';
import { Facts } from '@/ui/Facts';
import { Line } from '@/ui/Lines';
import { deviceTitle, standingWith } from '@/ui/naming';
import ui from '@/ui/ui.module.css';
import type { DayLine } from './days';

/**
 * One line of the diary as it is drawn wherever the diary is read - on a day's
 * card and under "Zuletzt" on Start: what somebody did as they wrote it, and
 * what the devices did by themselves marked as that - not an alarm still open. An alarm is its rule -
 * with its device, where another device's rule of that name has a line beside
 * it or its place holds another device, as a restart's line is -, how often it
 * fired and the edge it crossed; a silence that is over, until when it went on. A line that carries pictures
 * counts them as the way to them where the list has one (`onPictures`) - or
 * draws them, for a reader of a share link (`thumbnails`) - and only counts
 * them where it has none.
 */
export function DiaryLine({
  line,
  stamp,
  zone,
  now,
  people,
  measurements,
  byline,
  to = null,
  onOpen = null,
  opens,
  onStamp = null,
  stampDoes,
  forwards = false,
  plants,
  grow = null,
  onPictures = null,
  thumbnails,
  moment = instant => sinceLabel(instant, now, zone),
  named,
}: {
  line: DayLine;
  /** When it happened, as the list it stands in says moments. */
  stamp: string;
  zone: string | null;
  now: DateTime;
  people: Person[];
  /** What the grow the line belongs to calls its measurements. */
  measurements: ReadingName[];
  byline: boolean;
  /** Where a line worked out from the record leads: the curve of that moment. */
  to?: string | null;
  /** What a tap on a written line opens, and what that is called where it is not the correction. */
  onOpen?: (() => void) | null;
  opens?: string;
  /** What a tap on the stamp does, where the list has a use for a line's moment. */
  onStamp?: (() => void) | null;
  stampDoes?: string;
  /**
   * The list was folded oldest first: a line stands at the first of its run, and the other end of it is until when it
   * went on - except an alarm still open, which stands at its newest firing and says since when, as the diary does.
   */
  forwards?: boolean;
  /** The plants of the grows these lines belong to, so a line about some of them names those. */
  plants?: readonly Pick<Plant, 'id' | 'growId' | 'label'>[];
  /** The name of the grow a written line is of, where the list holds lines of more than one. */
  grow?: string | null;
  /** What opens the line's pictures, by their place among them. */
  onPictures?: ((index: number) => void) | null;
  /** The addresses of the line's pictures, where they are drawn in the line. */
  thumbnails?: string[];
  /** How the list says a moment, which a folded run's other end is said in: one form of a date in a row. */
  moment?: (instant: string) => string;
  /** What a device the account no longer holds is called, where the list was told. */
  named?: (deviceId: string) => string | null;
}) {
  const { t } = useTranslation();
  const { what } = line;
  // An alarm still open is no deed of the devices', and "von allein" on its red line read as over by itself.
  const mark = line.own || (what.kind === 'alarm' && what.stands) ? null : t('grow.diary.byItself');
  // A device's own line - an alarm, a restart - says which device where its place holds another, as Start and Meldungen do.
  const own = what.kind === 'alarm' || (what.kind === 'entry' && what.entry.kind === 'system');
  const device = useDeviceCalled(own ? what.entry.deviceId : null, what.kind === 'alarm' && what.twin, named);

  if (what.kind === 'said') {
    return (
      <Line stamp={stamp} mark={mark} to={to} onStamp={onStamp} stampDoes={stampDoes}>
        {what.words}
      </Line>
    );
  }
  if (what.kind === 'alarm') {
    return (
      <Line stamp={stamp} mark={mark} severity={what.over ? null : warningOf(what.entry)} onStamp={onStamp} stampDoes={stampDoes}>
        <span className={ui.visuallyHidden}>{`${t('home.entryKind.alarm')}: `}</span>
        <Facts
          facts={[
            what.rule,
            device,
            what.count > 1
              ? forwards && !what.stands
                ? t('home.entryRepeatsUntil', { count: what.count, until: moment(what.since) })
                : t('home.entryRepeats', { count: what.count, since: moment(what.since) })
              : what.until
                ? t('grow.diary.alarmUntil', { until: moment(what.until) })
                : null,
            // Over is said of every line that is, one "bis" its end too: "bis 14:55" alone read as a silence not yet ended.
            what.over ? t('grow.diary.alarmOver') : null,
          ]}
        />
        {what.limit ? <small>{what.limit}</small> : null}
      </Line>
    );
  }

  const { entry } = what;
  const carried = onPictures && entry.mediaIds.length > 0 ? { count: entry.mediaIds.length, onOpen: onPictures, thumbnails } : null;
  return (
    <Line
      stamp={stamp}
      mark={mark}
      severity={warningOf(entry)}
      onOpen={onOpen}
      opens={opens}
      onStamp={onStamp}
      stampDoes={stampDoes}
      pictures={carried}
    >
      <EntryWords
        entry={entry}
        people={people}
        measurements={measurements}
        now={now}
        zone={zone}
        byline={byline}
        repeats={forwards ? { ...what, until: what.since } : what}
        moment={moment}
        brief
        pictures={carried === null}
        plants={plants}
        grow={grow}
        device={device}
      />
    </Line>
  );
}

/**
 * What a device is called, where a line has to say which device it is about: always (`twin`), or where its place holds
 * another device. One the account no longer holds - given up since - is called by what the list was told (`named`).
 */
const useDeviceCalled = (deviceId: string | null, twin: boolean, named?: (deviceId: string) => string | null): string | null => {
  const { t } = useTranslation();
  const every = useDevicesShape(deviceId !== null).data?.items;
  const device = every?.find(one => one.id === deviceId);
  if (!deviceId) return null;
  if (!device) return named?.(deviceId) ?? null;
  const among = standingWith(device, every) ?? [];
  return twin || among.length > 1 ? deviceTitle(device, t, among) : null;
};
