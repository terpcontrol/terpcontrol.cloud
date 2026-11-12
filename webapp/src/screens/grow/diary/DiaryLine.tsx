import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Person, ReadingName } from '@fg2/shared-types/v1';
import { sinceLabel } from '@/ui/age';
import { warningOf } from '@/ui/entries';
import { EntryWords } from '@/ui/EntryRow';
import { Facts } from '@/ui/Facts';
import { Line } from '@/ui/Lines';
import ui from '@/ui/ui.module.css';
import type { DayLine } from './days';

/**
 * One line of the diary as it is drawn wherever the diary is read - on a day's
 * card and under "Zuletzt" on Start: what somebody did as they wrote it, and
 * what the devices did by themselves marked as that. An alarm is its rule,
 * how often it fired and the edge it crossed.
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
}) {
  const { t } = useTranslation();
  const mark = line.own ? null : t('grow.diary.byItself');
  const { what } = line;

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
            what.count > 1 ? t('home.entryRepeats', { count: what.count, since: sinceLabel(what.since, now, zone) }) : null,
            what.over ? t('grow.diary.alarmOver') : null,
          ]}
        />
        {what.limit ? <small>{what.limit}</small> : null}
      </Line>
    );
  }

  const { entry } = what;
  return (
    <Line stamp={stamp} mark={mark} severity={warningOf(entry)} onOpen={onOpen} opens={opens} onStamp={onStamp} stampDoes={stampDoes}>
      <span className={ui.visuallyHidden}>{`${t(`home.entryKind.${entry.kind}`)}: `}</span>
      <EntryWords entry={entry} people={people} measurements={measurements} now={now} zone={zone} byline={byline} repeats={what} brief pictures />
    </Line>
  );
}
