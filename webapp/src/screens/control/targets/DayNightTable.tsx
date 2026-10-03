import { CalendarRange, Moon, Sprout, Sun, Wind, type LucideIcon } from 'lucide-react';
import type { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { Help, Term } from '@/ui/Help';
import type { HelpTopic } from '@/ui/explain';
import { figure, targetFigure, UNIT } from '../../home/units';
import {
  halfOf,
  halvesOf,
  hasDay,
  holdsHumidity,
  phaseOf,
  rampsFor,
  type Field,
  type Half,
  type NowHolding,
  type Regime,
  type Shape,
} from './day-night';
import { windowWords } from './schedule-words';
import { Stepper } from './Stepper';
import { leafOffset, vpdOf, type TargetsDraft } from './targets-draft';
import styles from './DayNight.module.css';

interface TableProps {
  device: Device;
  /** The shape of the draft, which decides the columns and rows. */
  shape: Shape;
  /** The shape of what the device runs, which decides whether a column can be said to hold now. */
  storedShape: Shape;
  draft: TargetsDraft;
  /** What the device runs, which is what a changed figure is changed from. */
  baseline: TargetsDraft;
  set: (next: TargetsDraft) => void;
  hasCo2: boolean;
  readOnly: boolean;
  /** How far the account's wall clock is ahead of UTC, in seconds. */
  offset: number;
  holding: NowHolding;
  /** The figures a running plan writes back every hour. */
  owned: ReadonlySet<Field>;
  /** Now, which a light plan being edited is read against: the half it would hold once saved. */
  now: DateTime;
}

/** The range and step of each figure a stepper sets. */
const SPECS = {
  temperature: { min: 15, max: 35, step: 0.5, decimals: 1 },
  humidity: { min: 30, max: 90, step: 1, decimals: 0 },
  co2: { min: 400, max: 1500, step: 50, decimals: 0 },
  light: { min: 0, max: 100, step: 5, decimals: 0 },
} as const;

/** The regimes whose halves mean the same figures, so a column of one holds now if the other's does. */
const SCHEDULED: Regime[] = ['cycle', 'always', 'never'];

/**
 * The targets as one table: a row per figure the device holds in the mode it
 * runs, and a column per half of its day - the day's beside the night's, each
 * figure set in place with − and +. When each half runs stands in its head,
 * read off the light plan over the table; the column that holds right now is
 * shaded through every row, by what the device runs and never by the draft.
 *
 * There is nothing to switch between, and nothing drawn that the device does
 * not hold. Drying and germination have no day, so they are one column held
 * round the clock, and germination holds a temperature alone; greenhouse mode
 * holds no humidity; 24 hours of light have no night and none have no day -
 * the half they leave out is kept, unchanged, behind a line that says when it
 * holds again. CO₂ and the light limit are the day's alone, and CO₂ stands
 * only where a sensor measures it.
 */
export function DayNightTable(props: TableProps) {
  const { device, shape, storedShape, draft, baseline, set, hasCo2, readOnly, offset, holding, owned } = props;
  const { t } = useTranslation();
  const regime = shape.regime;
  const halves = halvesOf(regime);
  const single = halves.length === 1;
  const comparable = shape.regime === storedShape.regime || (SCHEDULED.includes(shape.regime) && SCHEDULED.includes(storedShape.regime));
  const holdingHalf = comparable && holding.half && halves.includes(holding.half) ? holding.half : null;
  // The heads show the light plan being edited, so the column marked has to be
  // read by it too: where saving it would turn the half over, the mark stands on
  // the column that will hold then and says so, rather than "holds now" under
  // times that do not include now.
  const after = afterSaveOf(props);
  const nowHalf = after ?? holdingHalf;
  const by = after ? 'draft' : holding.by;
  if (halves.length === 0) return null;

  const named = (half: Half, figureName: 'Temperature' | 'Humidity') =>
    regime === 'drying' || regime === 'germination' ? t(`targets.aria.${regime}${figureName}`) : t(`targets.aria.${half}${figureName}`);

  const stepper = (field: Field, name: string, spec: (typeof SPECS)[keyof typeof SPECS]) => (
    <Stepper
      name={name}
      value={draft[field]}
      {...spec}
      less={t('targets.stepLess', { name })}
      more={t('targets.stepMore', { name })}
      changed={draft[field] !== baseline[field]}
      disabled={readOnly}
      onChange={value => set({ ...draft, [field]: value })}
    />
  );

  const vpd = (half: Half, of: TargetsDraft) =>
    figure(
      vpdOf(
        half === 'day' ? of.dayTemperature : of.nightTemperature,
        half === 'day' ? of.dayHumidity : of.nightHumidity,
        leafOffset(device.settings, half),
      ),
      'vpd',
    );

  const rows: { key: string; label: string; unit: string; fields: Field[]; help?: HelpTopic; term?: ReactNode; cells: (half: Half) => ReactNode }[] =
    [
      {
        key: 'temperature',
        label: t('targets.table.temperature'),
        unit: UNIT.temperature ?? '°C',
        fields: ['dayTemperature', 'nightTemperature'],
        cells: half => stepper(half === 'day' ? 'dayTemperature' : 'nightTemperature', named(half, 'Temperature'), SPECS.temperature),
      },
    ];
  if (holdsHumidity(shape)) {
    rows.push({
      key: 'humidity',
      label: t('targets.table.humidity'),
      unit: UNIT.humidity ?? '%',
      fields: ['dayHumidity', 'nightHumidity'],
      cells: half => {
        const now = vpd(half, draft);
        return (
          <>
            {stepper(half === 'day' ? 'dayHumidity' : 'nightHumidity', named(half, 'Humidity'), SPECS.humidity)}
            <span className={styles.derived} data-changed={now !== vpd(half, baseline) || undefined}>
              <Term topic="vpd">{t('targets.table.vpd', { value: now })}</Term>
            </span>
          </>
        );
      },
    });
  }
  if (hasDay(regime) && hasCo2) {
    rows.push({
      key: 'co2',
      label: t('targets.table.co2'),
      unit: UNIT.co2 ?? 'ppm',
      fields: ['co2'],
      cells: half =>
        half === 'day' ? stepper('co2', t('targets.aria.co2'), SPECS.co2) : <span className={styles.none}>{t('targets.table.co2Night')}</span>,
    });
  }
  if (hasDay(regime)) {
    rows.push({
      key: 'light',
      label: t('targets.table.light'),
      unit: '%',
      fields: ['lightLimit'],
      help: 'lightLimit',
      cells: half =>
        half === 'day' ? (
          stepper('lightLimit', t('targets.aria.lightLimit'), SPECS.light)
        ) : (
          <span className={styles.none}>{t('targets.table.lightNight')}</span>
        ),
    });
  }

  return (
    <div className={styles.section}>
      <div
        className={styles.table}
        role="table"
        aria-label={t('targets.table.label')}
        data-single={single || undefined}
        data-now={nowHalf ?? undefined}
        data-by={by}
      >
        <div role="row" className={styles.tr} style={{ gridRow: 1 }}>
          <div role="columnheader" className={`${styles.th} ${styles.corner}`} aria-label={t('targets.table.figure')} />
          {halves.map(half => (
            <div key={half} role="columnheader" className={`${styles.td} ${styles.colHead}`}>
              <ColumnHead regime={regime} half={half} draft={draft} baseline={baseline} offset={offset} />
              {nowHalf === half ? (
                <span className={styles.nowTag} data-by={by}>
                  {t(
                    by === 'draft'
                      ? 'targets.table.afterSave'
                      : by === 'schedule'
                        ? // Only a light plan is a schedule; a drying room offline is held as it was last left.
                          storedShape.regime === 'cycle'
                          ? 'targets.table.bySchedule'
                          : 'targets.table.byLastState'
                        : 'targets.table.now',
                  )}
                </span>
              ) : null}
            </div>
          ))}
        </div>

        {rows.map((row, index) => {
          const planned = row.fields.some(field => owned.has(field));
          return (
            <div role="row" className={styles.tr} key={row.key} style={{ gridRow: index + 2 }}>
              <div role="rowheader" className={styles.th}>
                <span className={styles.thLabel}>
                  {row.label}
                  {row.help ? <Help topic={row.help} /> : null}
                </span>
                <span className={styles.thUnit}>{row.unit}</span>
                {planned ? (
                  <CalendarRange size={13} strokeWidth={2} className={styles.planMark} role="img" aria-label={t('targets.table.planMark')} />
                ) : null}
              </div>
              {halves.map(half => (
                <div key={half} role="cell" className={styles.td}>
                  {row.cells(half)}
                </div>
              ))}
            </div>
          );
        })}

        {nowHalf ? <span className={styles.nowColumn} style={{ gridRow: `1 / span ${rows.length + 1}` }} aria-hidden /> : null}
      </div>

      <Notes {...props} />
    </div>
  );
}

const TITLE_ICON: Partial<Record<Regime, LucideIcon>> = { drying: Wind, germination: Sprout, never: Moon, always: Sun };

/**
 * A column's head: what the half is called and when it runs. The night's
 * times are the day's read backwards, and are text rather than fields - the
 * night is what the light plan leaves.
 */
function ColumnHead({
  regime,
  half,
  draft,
  baseline,
  offset,
}: {
  regime: Regime;
  half: Half;
  draft: TargetsDraft;
  baseline: TargetsDraft;
  offset: number;
}) {
  const { t } = useTranslation();
  const words = windowWords(draft, offset);
  const before = windowWords(baseline, offset);
  const Icon = TITLE_ICON[regime] ?? (half === 'day' ? Sun : Moon);

  // A lamp at 0 % keeps the day without any light in it, so the day is not called "light on".
  const dark = draft.lightLimit <= 0;
  const [title, what, span, changed]: [string, string | null, string[] | null, boolean] =
    regime === 'cycle'
      ? half === 'day'
        ? [
            t(dark ? 'targets.table.dayPlain' : 'targets.table.dayTitle'),
            t(dark ? 'targets.table.dayDark' : 'targets.table.dayWhat'),
            [`${words.on}–${words.off}`, t('targets.table.hours', { hours: words.hours })],
            words.on !== before.on || words.off !== before.off,
          ]
        : [
            t(dark ? 'targets.table.nightPlain' : 'targets.table.nightTitle'),
            dark ? null : t('targets.table.nightWhat'),
            [`${words.off}–${words.on}`, t('targets.table.hours', { hours: words.nightHours })],
            words.on !== before.on || words.off !== before.off,
          ]
      : regime === 'sensor'
        ? half === 'day'
          ? [t('targets.table.brightTitle'), null, [t('targets.table.brightSub')], false]
          : [t('targets.table.darkTitle'), null, [t('targets.table.darkSub')], false]
        : regime === 'always'
          ? [t('targets.table.alwaysTitle'), null, [t('targets.table.alwaysSub')], false]
          : regime === 'never'
            ? [t('targets.table.neverTitle'), null, [t('targets.table.neverSub')], false]
            : [t(`targets.table.${regime}Title`), null, [t('targets.table.roundTheClock')], false];

  return (
    <>
      <span className={styles.colTitle} data-half={regime === 'cycle' || regime === 'sensor' ? half : regime === 'always' ? 'day' : 'night'}>
        <Icon size={15} strokeWidth={2} aria-hidden />
        {title}
        {what ? <span className={styles.colWhat}> {what}</span> : null}
      </span>
      {span ? (
        <span className={styles.colSpan} data-changed={changed || undefined}>
          {span.map((part, index) => (
            <span key={part}>
              {index > 0 ? <span className={styles.colDot}>· </span> : null}
              {part}
            </span>
          ))}
        </span>
      ) : null}
    </>
  );
}

/**
 * What the table leaves out, said under it: a lamp at 0 % that still keeps
 * its day, and the half a regime of one column keeps for later - the night at
 * 24 hours of light, the day at none - written out behind a line that says
 * when it holds again, so it is neither lost nor taken for what runs.
 */
function Notes({ device, shape, baseline, hasCo2 }: TableProps) {
  const { t } = useTranslation();
  const regime = shape.regime;
  // What is kept is what the device stores, not what was typed: a save that
  // leaves a half unused keeps the stored one, so a night edited and then set
  // to 24 hours of light is not shown as kept when it is not.
  const draft = baseline;
  const pair = (temperature: number, humidity: number) =>
    [
      `${targetFigure(temperature, 'temperature')} ${UNIT.temperature}`,
      holdsHumidity(shape) ? `${targetFigure(humidity, 'humidity')} ${UNIT.humidity}` : null,
    ].filter((part): part is string => part !== null);

  // What germination gives back to the night, where it is not what germination holds anyway.
  const before = regime === 'germination' ? (device.control?.afterGermination?.nightTemperature ?? null) : null;
  const back = before !== null && before !== draft.nightTemperature ? before : null;
  const kept =
    regime === 'always'
      ? { summary: t('targets.table.keptNight'), parts: pair(draft.nightTemperature, draft.nightHumidity) }
      : regime === 'never'
        ? {
            summary: t('targets.table.keptDay'),
            parts: [
              ...pair(draft.dayTemperature, draft.dayHumidity),
              ...(hasCo2 ? [`CO₂ ${targetFigure(draft.co2, 'co2')} ${UNIT.co2}`] : []),
              t('targets.table.keptLight', { percent: Math.round(draft.lightLimit) }),
            ],
          }
        : null;

  if (!kept && back === null) return null;

  return (
    <>
      {back !== null ? (
        <p className={styles.note}>
          {t('targets.table.germinationBack', { temperature: `${targetFigure(back, 'temperature')} ${UNIT.temperature}` })}
        </p>
      ) : null}
      {kept ? (
        <details className={styles.kept}>
          <summary>{kept.summary}</summary>
          <p className="mono">{kept.parts.join(' · ')}</p>
          <p>{t(regime === 'always' ? 'targets.table.keptNightHow' : 'targets.table.keptDayHow')}</p>
        </details>
      ) : null}
    </>
  );
}

/**
 * The half a light plan being edited would hold now once saved, where it is
 * not the one that holds: null while the plan is not being moved, or moving it
 * changes nothing about now.
 */
const afterSaveOf = ({ device, shape, storedShape, draft, baseline, holding, now }: TableProps): Half | null => {
  const moved = draft.lightsOn !== baseline.lightsOn || draft.lightHours !== baseline.lightHours;
  if (!moved || !SCHEDULED.includes(shape.regime) || !SCHEDULED.includes(storedShape.regime)) return null;
  const after: Half =
    shape.regime === 'always'
      ? 'day'
      : shape.regime === 'never'
        ? 'night'
        : halfOf(phaseOf(draft, rampsFor(device, device.configuration, draft), now));
  return after === holding.half ? null : after;
};
