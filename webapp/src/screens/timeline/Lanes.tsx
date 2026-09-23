import { DateTime } from 'luxon';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Entry, SpaceTimeline } from '@fg2/shared-types/v1';
import { EntryRow } from '@/ui/EntryRow';
import { KIND_ICON, readingNamesOf } from '@/ui/entries';
import { at, fractionOf, stampOf, stopOf } from './window';
import styles from './Timeline.module.css';

/** How far apart two marks stand before they are drawn as one: the mark itself, and room to tell them apart. */
const MARK_PITCH = 30;

/** A phone's rail, used until the real one has been measured, so the first paint of a phone is already right. */
const PHONE_RAIL = 280;

/** Five stops, which is as many as fit under a phone's width without the times touching. */
const AXIS_STOPS = 5;

interface LanesProps {
  timeline: SpaceTimeline;
  from: number;
  to: number;
  cursor: number;
  now: DateTime;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onScrub: (time: number) => void;
  scrub: React.HTMLAttributes<HTMLDivElement>;
}

/**
 * What the outputs did and what anybody wrote, under the curves they explain.
 * A lane says when something ran, not what it measured; a mark on the rail says
 * that a line exists there, and tapping it puts the line under the rail and the
 * cursor on its moment - which is the whole reason the two are drawn together.
 */
export function Lanes({ timeline, from, to, cursor, now, selected, onSelect, onScrub, scrub }: LanesProps) {
  const { t } = useTranslation();
  // How many lines fit on the rail is a question about pixels, so the rail is
  // measured: a desktop's rail carries three times a phone's marks.
  const rail = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(PHONE_RAIL);
  useEffect(() => {
    const element = rail.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width || PHONE_RAIL));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const marks = clusterOf(timeline.events, from, to, width);
  const open = marks.find(mark => mark.key === selected) ?? null;
  const left = `${fractionOf(cursor, from, to) * 100}%`;

  return (
    <section className={styles.lanes}>
      {timeline.outputs.map(lane => (
        <div key={`${lane.deviceId}-${lane.output}`} className={styles.lane}>
          <span className={`label ${styles.laneName}`}>{t(`timeline.output.${lane.output}`, { defaultValue: lane.output })}</span>
          <div className={styles.track} {...scrub}>
            {lane.spans.map(span => (
              <span
                key={span.startsAt}
                className={styles.bar}
                style={{ left: `${fractionOf(at(span.startsAt), from, to) * 100}%`, width: `${widthOf(span, from, to)}%` }}
              />
            ))}
            <span className={styles.cursor} style={{ left }} />
          </div>
        </div>
      ))}

      <div className={styles.lane}>
        <span className={`label ${styles.laneName}`}>{t('timeline.events')}</span>
        <div className={styles.rail} ref={rail}>
          {marks.length === 0 ? <span className={`mono ${styles.noEvents}`}>{t('timeline.noEvents')}</span> : null}
          {marks.map(mark => {
            const Icon = KIND_ICON[mark.entries[0].kind];
            return (
              <button
                key={mark.key}
                type="button"
                className={styles.mark}
                data-severity={mark.entries.find(entry => entry.severity)?.severity ?? undefined}
                aria-pressed={mark.key === selected}
                style={{ left: `${fractionOf(mark.time, from, to) * 100}%` }}
                title={stampOf(mark.time, to - from)}
                onClick={() => {
                  onSelect(mark.key === selected ? null : mark.key);
                  onScrub(mark.time);
                }}
              >
                <Icon size={12} strokeWidth={2} aria-hidden />
                {mark.entries.length > 1 ? <span className={`mono ${styles.markCount}`}>{mark.entries.length}</span> : null}
              </button>
            );
          })}
          <span className={styles.cursor} style={{ left }} />
        </div>
      </div>

      <div className={styles.axis}>
        {Array.from({ length: AXIS_STOPS }, (_, index) => {
          const time = from + ((to - from) * index) / (AXIS_STOPS - 1);
          return (
            <span key={index} className={`mono ${styles.stop}`}>
              {index === AXIS_STOPS - 1 && now.diff(DateTime.fromMillis(to)).as('minutes') < 2 ? t('timeline.now') : stopOf(time, to - from)}
            </span>
          );
        })}
      </div>

      {open ? (
        <ul className={styles.opened}>
          {open.entries.map(entry => (
            <EntryRow
              key={entry.id}
              entry={entry}
              people={timeline.people}
              measurements={readingNamesOf(timeline.readingNames, entry.growId)}
              now={now}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** A run never leaves the lane; one too short to be a bar is kept visible by the lane's own minimum. */
const widthOf = (span: { startsAt: string; endsAt: string }, from: number, to: number): number =>
  (fractionOf(at(span.endsAt), from, to) - fractionOf(at(span.startsAt), from, to)) * 100;

interface Mark {
  key: string;
  time: number;
  entries: Entry[];
}

/**
 * Lines closer together than a thumb share one mark, which then says how many
 * it stands for. They are gathered from the left rather than into fixed bins,
 * so every mark sits on a moment a line was really written - the rail would
 * otherwise draw a feed at nine as having happened at eight.
 */
const clusterOf = (events: Entry[], from: number, to: number, width: number): Mark[] => {
  const apart = Math.max(1, ((to - from) * MARK_PITCH) / Math.max(MARK_PITCH, width));
  const marks: Mark[] = [];
  for (const entry of [...events].sort((one, other) => at(one.occurredAt) - at(other.occurredAt))) {
    const last = marks.at(-1);
    if (last && at(entry.occurredAt) - last.time < apart) last.entries.push(entry);
    else marks.push({ key: entry.id, time: at(entry.occurredAt), entries: [entry] });
  }

  return marks;
};
