import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Entry, Plant, SpaceTimeline } from '@fg2/shared-types/v1';
import { dayLines, forwardsOf, type Silences } from '@/screens/grow/diary/days';
import { DiaryLine } from '@/screens/grow/diary/DiaryLine';
import { silentSince } from '@/ui/age';
import { readingNamesOf } from '@/ui/entries';
import { useKept } from '@/ui/kept';
import { deviceName } from '@/ui/naming';
import { Lines } from '@/ui/Lines';
import { useZone } from '@/ui/zone';
import { cursorStamp } from './labels';
import type { Shown } from './model';
import { at } from './window';
import styles from './Timeline.module.css';

/** How many lines stand in the card before the rest wait behind a tap: a month of a chatty tent holds hundreds. */
const SHOWN = 12;

interface DiaryCardProps {
  data: SpaceTimeline;
  shown: Pick<Shown, 'diary' | 'machine'>;
  now: DateTime;
  onCursor: (time: number) => void;
  /** How a line of the reader's own is put right; nothing for a reader who may not. */
  correct?: (entry: Entry) => (() => void) | undefined;
  /** Whether a line names who wrote it. */
  byline: boolean;
  /** Writes a note dated to the cursor, where the reader may: the instant in words, and the way to the sheet. */
  note: { at: string; write: () => void } | null;
  /** The plants of the grow the page is of, where the reader is told them: a line about some of them names those. */
  plants?: readonly Pick<Plant, 'id' | 'growId' | 'label'>[];
}

/**
 * What was written in the window, as the diary tells it - a run of the same device line folded, an alarm by its rule,
 * maintenance as one line, the moment another device took over the measuring - oldest first, the way the curves above run. A line's stamp sets
 * the cursor on its moment; its words open its correction, as everywhere a line is read.
 */
export function DiaryCard({ data, shown, now, onCursor, correct, byline, note, plants }: DiaryCardProps) {
  const { t, i18n } = useTranslation();
  const zone = useZone();
  const [all, setAll] = useKept('timeline-lines', false);
  const window = { from: at(data.startsAt), to: at(data.endsAt) };
  const entries = data.events.filter(entry => (entry.source === 'human' ? shown.diary : shown.machine));
  // A change of the device the curves are of, maintenance and regulation off are lines the devices' own tick shows,
  // each as the grow's diary says it - a maintenance one line for on and off together.
  const events = shown.machine ? [...data.deviceChanges, ...(data.stretches ?? [])] : [];
  const lines = forwardsOf(dayLines(t, i18n, { entries, events, endsAt: data.endsAt }, zone, silencesOf(data)));
  // Where the lines are of two grows, each names its own, as Start's do.
  const grows = new Set(entries.flatMap(entry => (entry.growId ? [entry.growId] : [])));
  const growOf = (entry: Entry | null) => (grows.size > 1 ? (data.grows.find(one => one.growId === entry?.growId)?.name ?? null) : null);
  const listed = all ? lines : lines.slice(-SHOWN);
  // A device the account no longer holds is named by what the answer says it was called.
  const named = (deviceId: string) => {
    const told = data.devices.find(one => one.deviceId === deviceId);
    return told ? deviceName(told, t) : null;
  };
  // A stretch the window cuts stands at its true start, before the window: the stamps are of the span they reach, in
  // one form, and its stamp sets the cursor where the window begins.
  const reached = { from: Math.min(window.from, ...lines.map(line => at(line.at))), to: window.to };

  return (
    <section className={styles.card} aria-labelledby="timeline-diary">
      <h2 id="timeline-diary" className={styles.cardTitle}>
        {t('timeline.diary.title')}
      </h2>
      {lines.length > listed.length ? (
        <button type="button" className={styles.more} onClick={() => setAll(true)}>
          {t('timeline.diary.all', { count: lines.length })}
        </button>
      ) : null}
      {lines.length === 0 ? (
        <p className={styles.none}>{t('timeline.diary.none')}</p>
      ) : (
        <Lines>
          {listed.map(line => {
            const entry = line.what.kind === 'entry' ? line.what.entry : null;
            return (
              <DiaryLine
                key={line.key}
                line={line}
                stamp={cursorStamp(at(line.at), reached, 60, zone)}
                moment={instant => cursorStamp(at(instant), reached, 60, zone)}
                zone={zone}
                now={now}
                people={data.people}
                measurements={entry ? readingNamesOf(data.readingNames, entry.growId) : []}
                byline={byline}
                onOpen={entry ? (correct?.(entry) ?? null) : null}
                onStamp={() => onCursor(Math.max(window.from, at(line.at)))}
                forwards
                plants={plants}
                grow={growOf(entry)}
                stampDoes={t('timeline.diary.toMoment')}
                named={named}
              />
            );
          })}
        </Lines>
      )}
      {data.machineEvents.total > data.machineEvents.shown && shown.machine ? (
        <p className={styles.none}>{t('timeline.diary.capped', { shown: data.machineEvents.shown, total: data.machineEvents.total })}</p>
      ) : null}
      {note ? (
        <button type="button" className={styles.more} onClick={note.write}>
          {t('timeline.diary.note', { at: note.at })}
          {'\u00a0›'}
        </button>
      ) : null}
    </section>
  );
}

/**
 * When each silence the window's alarms tell of began, to the second - a line written before its seconds were has its
 * span rounded -, and when it ended: a window that ends inside a silence holds no line of its end.
 */
const silencesOf = (data: SpaceTimeline): Silences => {
  const silences = new Map(
    data.alarms.flatMap(alarm => (alarm.kind === 'offline' || alarm.kind === 'camera_stale' ? [[alarm.alertId, alarm] as const] : [])),
  );
  const of = (entry: Entry) => (entry.alertId ? silences.get(entry.alertId) : undefined);
  return {
    began: entry => {
      const alarm = of(entry);
      return alarm && alarm.value !== null ? silentSince(alarm) : null;
    },
    ended: entry => of(entry)?.endedAt ?? null,
  };
};
