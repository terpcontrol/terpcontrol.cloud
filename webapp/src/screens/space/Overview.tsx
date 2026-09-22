import { ChevronRight, Circle, Leaf, Sliders } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type {
  CardSetpoint,
  CardValue,
  ClimateVerdict,
  Metric,
  OverviewCamera,
  OverviewGrow,
  OverviewTask,
  SpaceOverview,
} from '@fg2/shared-types/v1';
import { THUMBNAIL_WIDTH, mediaUrl } from '@/api/session';
import { useLog, useMayLog } from '@/log/log-context';
import { ageAttribute, ageLabel } from '@/ui/age';
import type { Liveness } from '../home/attention';
import { EntryRow } from '@/ui/EntryRow';
import { readingFigure } from '@/ui/entries';
import { useMayManage } from '@/ui/session-access';
import { weekOfPhase } from '@/ui/stages';
import ui from '@/ui/ui.module.css';
import { livenessOf, measuredAtOf } from '../home/attention';
import { figure, targetFigure, UNIT } from '../home/units';
import { MoveHereSheet } from './MoveHereSheet';
import { PresetSheet } from './PresetSheet';
import styles from './Overview.module.css';

/** Four tiles across a phone: the three the controller steers and the one it derives. */
const TILES: Metric[] = ['temperature', 'humidity', 'vpd', 'co2'];

/** How many of the day's pictures a strip shows; the camera page has the rest. */
const STILLS_SHOWN = 6;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The Overview tab: what is true here now, what needs a human, what grows
 * here, what the cameras saw today, how the last day went and what was last
 * written. Every section is there only while it has something to say, except
 * the values, which are the tent.
 */
export function Overview({ overview, now }: { overview: SpaceOverview; now: DateTime }) {
  const { t } = useTranslation();
  const mayManage = useMayManage();
  const hasDevice = overview.deviceIds === null || overview.deviceIds.length > 0;
  const liveness = livenessOf(overview);
  const [sheet, setSheet] = useState<'preset' | 'move' | null>(null);

  return (
    <div className={styles.overview}>
      {hasDevice ? <Values overview={overview} /> : <p className={`${ui.cardDashed} ${ui.note}`}>{t('home.invite.noSensor')}</p>}
      {overview.targets ? <TargetsLine overview={overview} /> : null}

      {/* The phase tiles, as one sheet: what a tent is put on is a stage with a
          climate on top of it, and what that comes to is said in the sheet. */}
      {mayManage ? (
        <div className={styles.spaceActions}>
          <button type="button" className={`${ui.chip} ${styles.spaceAction}`} onClick={() => setSheet('preset')}>
            <Sliders size={13} strokeWidth={1.75} aria-hidden />
            {t('space.presets.open')}
          </button>
        </div>
      ) : null}

      {overview.dueTasks.length > 0 ? (
        <Section label={t('space.dueNow')} link={{ to: '/tasks', label: t('shell.tabs.tasks') }}>
          <ul className={styles.list}>
            {overview.dueTasks.map(task => (
              <DueCard key={task.id} task={task} overview={overview} now={now} />
            ))}
          </ul>
        </Section>
      ) : null}

      <Section
        label={t('space.growingHere')}
        actions={
          <span className={`mono ${styles.sectionActions}`}>
            <Link to={`/log?kind=phase&space=${overview.spaceId}`}>+ {t('space.newGrow')}</Link>
            {mayManage ? (
              <>
                {' · '}
                <button type="button" className={styles.sectionButton} onClick={() => setSheet('move')}>
                  {t('space.moveHere')}
                </button>
              </>
            ) : null}
          </span>
        }
      >
        {overview.grows.length === 0 ? (
          <p className={ui.note}>{t('home.invite.noGrow')}</p>
        ) : (
          <ul className={styles.list}>
            {overview.grows.map(grow => (
              <GrowRow key={grow.growId} grow={grow} still={overview.cameras[0]?.stills.at(-1)?.mediaId ?? null} />
            ))}
          </ul>
        )}
      </Section>

      {overview.cameras.map(camera => (
        <Section key={camera.cameraId} label={`${camera.name} · ${t('space.today')}`}>
          <CameraStrip camera={camera} now={now} />
        </Section>
      ))}

      {hasDevice ? (
        <Section
          label={climateLabel(t, liveness, measuredAtOf(overview.values), now)}
          // Charts opens from here as well as from the Timeline header: this is
          // the section a grower is already reading the climate in.
          actions={
            <span className={`mono ${styles.sectionActions}`}>
              <Link to={`/charts?space=${overview.spaceId}`}>{t('charts.title')}</Link>
            </span>
          }
          link={{ to: `/spaces/${overview.spaceId}/timeline`, label: t('space.tabs.timeline') }}
        >
          <Verdict verdict={overview.verdict} liveness={liveness} />
        </Section>
      ) : null}

      <Section label={t('space.latest')} link={{ to: `/spaces/${overview.spaceId}/timeline`, label: t('space.all') }}>
        {overview.entries.length === 0 ? (
          <p className={ui.note}>{t('home.card.noEntries')}</p>
        ) : (
          <ul className={styles.entries}>
            {overview.entries.map(entry => (
              <EntryRow key={entry.id} entry={entry} people={overview.people} withDay={!DateTime.fromISO(entry.occurredAt).hasSame(now, 'day')} />
            ))}
          </ul>
        )}
      </Section>

      {sheet === 'preset' ? <PresetSheet overview={overview} onClose={() => setSheet(null)} /> : null}
      {sheet === 'move' ? <MoveHereSheet spaceId={overview.spaceId} spaceName={overview.name} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

function Section({
  label,
  link,
  actions,
  children,
}: {
  label: string;
  link?: { to: string; label: string };
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <span className="label">{label}</span>
        {actions}
        {link ? (
          <Link to={link.to} className={`mono ${styles.sectionLink}`}>
            {link.label}
            <ChevronRight size={12} strokeWidth={2} aria-hidden />
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** The tiles: each value large, its target and where it stands against it, dimmed by its age and never hidden. */
function Values({ overview }: { overview: SpaceOverview }) {
  const { t } = useTranslation();
  const shown = TILES.flatMap(metric => overview.values.filter(value => value.metric === metric));
  const setpointOf = (metric: Metric): CardSetpoint | null => overview.setpoints.find(setpoint => setpoint.metric === metric) ?? null;

  if (shown.length === 0) return <p className={`${ui.cardDashed} ${ui.note}`}>{t('space.noReadingsYet')}</p>;

  return (
    <div className={styles.tiles}>
      {shown.map(value => (
        <Tile key={value.metric} value={value} setpoint={setpointOf(value.metric)} />
      ))}
    </div>
  );
}

function Tile({ value, setpoint }: { value: CardValue; setpoint: CardSetpoint | null }) {
  const { t } = useTranslation();
  // The band is the server's, the same width the verdict below judges by.
  const band = setpoint?.band ?? null;
  const delta = value.value !== null && setpoint?.value != null ? value.value - setpoint.value : null;

  return (
    <div className={`${ui.card} ${styles.tile}`} {...ageAttribute(value.state)}>
      <div className={styles.tileFigure}>
        <span className="figure">{value.value === null ? t('home.card.noReading') : figure(value.value, value.metric)}</span>
        <span className={`mono ${styles.tileUnit}`}>{UNIT[value.metric] ?? value.metric}</span>
      </div>
      <div className={`mono ${styles.tileTarget}`}>
        {setpoint && setpoint.value !== null ? (
          <>
            <span>→ {targetFigure(setpoint.value, value.metric)}</span>
            {delta !== null && band !== null ? (
              Math.abs(delta) <= band ? (
                <span className={styles.inBand}>{t('home.card.inBand')}</span>
              ) : (
                <span
                  className={styles.offBand}
                >{`${delta > 0 ? '+' : '−'}${figure(Math.abs(delta), value.metric)} ${t(delta > 0 ? 'space.high' : 'space.low')}`}</span>
              )
            ) : null}
          </>
        ) : (
          <>
            <span>{t(`home.metric.${value.metric}`, { defaultValue: value.metric })}</span>
            <span>{t('home.card.noTarget')}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** "Flower preset · day 26 / 62 · night 21 / 58 · CO₂ 1100": what the controller is aiming at in both halves. */
function TargetsLine({ overview }: { overview: SpaceOverview }) {
  const { t } = useTranslation();
  const targets = overview.targets!;
  const half = (row: CardSetpoint[]) =>
    ['temperature', 'humidity']
      .flatMap(metric => {
        const value = row.find(setpoint => setpoint.metric === metric)?.value;
        return value === null || value === undefined ? [] : [targetFigure(value, metric as Metric)];
      })
      .join(' / ');
  const co2 = targets.day.find(setpoint => setpoint.metric === 'co2')?.value ?? null;
  const preset = overview.grows[0]?.preset ?? overview.grows[0]?.stage ?? null;

  return (
    <p className={`mono ${styles.targetsLine}`}>
      {preset ? `${t(`home.stage.${overview.grows[0].stage}`)} ${t('space.preset')} · ` : ''}
      {t('space.day')} {half(targets.day)} · {t('space.night')} {half(targets.night)}
      {co2 !== null ? ` · CO₂ ${co2}` : ''}
    </p>
  );
}

/** A due task with its Done, which says what it is about to write. */
function DueCard({ task, overview, now }: { task: OverviewTask; overview: SpaceOverview; now: DateTime }) {
  const { t } = useTranslation();
  const { complete } = useLog();
  const mayLog = useMayLog();
  const subject = task.subject.type === 'grow' ? (overview.grows.find(grow => grow.growId === task.subject.id)?.name ?? '') : overview.name;
  const writes = t(`home.entryKind.${task.kind === 'chore' || task.kind === 'custom' ? 'note' : task.kind}`);
  const defaults = defaultsLabel(task.defaults);
  const assignee = task.assigneeId ? overview.people.find(person => person.id === task.assigneeId)?.handle : null;

  return (
    <li className={`${ui.card} ${styles.due}`}>
      <Circle size={16} strokeWidth={1.75} className={styles.dueCircle} aria-hidden />
      <div className={styles.dueText}>
        <span className={styles.dueTitle}>
          {task.label} · {subject}
          {defaults ? <span className={styles.muted}> · {defaults}</span> : null}
        </span>
        <span className={`mono ${styles.dueMeta}`}>
          {dueLabel(t, task.dueAt, now)}
          {assignee ? ` · @${assignee}` : ''}
          {' · '}
          {t('space.doneWrites', { what: writes, subject })}
        </span>
      </div>
      {/* Done is the whole interaction: the completion writes the entry the task
          implies, and the toast that follows is where it can be taken back. */}
      {mayLog ? (
        <button
          type="button"
          className={`${ui.button} ${ui.primary} ${styles.doneButton}`}
          onClick={() => complete(task.id, `${writes} · ${subject}`)}
        >
          {t('home.strip.done')}
        </button>
      ) : null}
    </li>
  );
}

/**
 * "water 2": the readings a completion is prefilled with. The overview carries
 * no measurement definitions, so a reading is named by its key rather than by
 * the name and unit the grow gave it; the log sheet, which has the grow, says
 * it properly.
 */
const defaultsLabel = (defaults: unknown): string => {
  const readings = defaults && typeof defaults === 'object' && 'readings' in defaults ? (defaults as { readings: unknown }).readings : null;
  if (!Array.isArray(readings)) return '';
  return readings
    .filter((reading): reading is { key: string; value: number } => typeof reading?.key === 'string' && typeof reading?.value === 'number')
    .map(reading => `${reading.key.split('_')[0]} ${readingFigure(reading.value)}`)
    .join(' · ');
};

/** "today", "tomorrow", "in 3 d", or how overdue - the words the Tasks tab counts a task down in. */
const dueLabel = (t: Translate, dueAt: string, now: DateTime): string => {
  const days = Math.floor(DateTime.fromISO(dueAt).startOf('day').diff(now.startOf('day'), 'days').days);
  if (days < 0) return t('home.strip.overdue', { count: -days });
  if (days === 0) return t('home.strip.today');
  if (days === 1) return t('home.strip.tomorrow');
  return t('home.strip.inDays', { count: days });
};

/** A grow standing here: the card the home draws, plus since when it has stood here. */
function GrowRow({ grow, still }: { grow: OverviewGrow; still: string | null }) {
  const { t } = useTranslation();
  const coverId = grow.coverMediaId ?? still;
  const cover = coverId ? mediaUrl(coverId, THUMBNAIL_WIDTH.cover) : null;
  const week = weekOfPhase(grow.phaseDay);

  return (
    <li>
      <Link to={`/grows/${grow.growId}`} className={`${ui.card} ${styles.growRow}`}>
        <span className={styles.cover}>{cover ? <img src={cover} alt="" /> : <Leaf size={22} strokeWidth={1.5} aria-hidden />}</span>
        <span className={styles.growText}>
          <span className={styles.growTitle}>
            <span className={styles.growName}>{grow.name}</span>
            {grow.dayNumber !== null ? <span className={`figure ${styles.growDay}`}>{t('home.card.dayN', { day: grow.dayNumber })}</span> : null}
          </span>
          <span className={styles.growLine}>
            {grow.stage ? t(`home.stage.${grow.stage}`) : t('home.card.noPhase')}
            {week !== null ? ` · ${t('home.card.week', { week })}` : ''}
            {grow.isAuto ? <span className={`mono ${styles.auto}`}>{t('home.card.auto')}</span> : null}
            {grow.strains.length > 0 ? ` · ${grow.strains.join(', ')}` : ''}
            {grow.placedOnDay !== null && grow.placedOnDay > 1 ? ` · ${t('space.hereSince', { day: grow.placedOnDay })}` : ''}
          </span>
        </span>
        <ChevronRight size={16} strokeWidth={1.75} className={styles.chevron} aria-hidden />
      </Link>
    </li>
  );
}

/** The day's pictures of one camera, a handful spread over the day, each with the hour it was taken. */
function CameraStrip({ camera, now }: { camera: OverviewCamera; now: DateTime }) {
  const { t } = useTranslation();
  const stills = camera.stills.slice(-STILLS_SHOWN);

  if (stills.length === 0) {
    return (
      <p className={ui.note}>
        {t('space.noStillsToday')}
        {camera.lastStillAt ? ` · ${t('space.lastStill', { age: ageLabel(camera.lastStillAt, now) })}` : ''}
      </p>
    );
  }

  return (
    <ul className={styles.strip}>
      {stills.map(still => {
        const src = mediaUrl(still.mediaId, THUMBNAIL_WIDTH.still);
        return (
          <li key={still.mediaId} className={styles.stillTile}>
            {src ? (
              <img
                src={src}
                alt={t('space.stillAlt', { name: camera.name, time: DateTime.fromISO(still.capturedAt).toFormat('HH:mm') })}
                loading="lazy"
              />
            ) : null}
            <span className={`mono ${styles.stillTime}`}>{DateTime.fromISO(still.capturedAt).toFormat('HH:mm')}</span>
          </li>
        );
      })}
    </ul>
  );
}

const WIDTH = 320;
const HEIGHT = 48;

/**
 * "Climate · 24 h" while the tent is heard from. Once it has gone quiet the
 * day the verdict is about ended when the last reading came in, and the label
 * says so rather than calling a window that stopped hours ago the last 24 h.
 */
const climateLabel = (t: Translate, liveness: Liveness, measuredAt: string | null, now: DateTime): string => {
  if (liveness === 'live' || !measuredAt) return t('space.climate24h');

  const last = DateTime.fromISO(measuredAt);
  return t('space.climate24hUntil', { time: last.toFormat(last.hasSame(now, 'day') ? 'HH:mm' : 'ccc HH:mm') });
};

/**
 * The 24 h verdict in the board's words: the share of the day in band, the
 * excursions that left it and how often each actuator ran, over the day's
 * temperature as a line with its band. Dimmed with the values it was read
 * from, so a verdict on a tent that has gone quiet reads as old.
 */
function Verdict({ verdict, liveness }: { verdict: ClimateVerdict; liveness: Liveness }) {
  const { t } = useTranslation();
  const temperature = verdict.metrics.find(row => row.metric === 'temperature');

  return (
    <div
      className={`${ui.card} ${styles.verdict}`}
      data-rating={verdict.rating ?? undefined}
      {...(liveness === 'none' ? {} : ageAttribute(liveness))}
    >
      <TrendLine verdict={verdict} bands={[temperature?.dayBand ?? null, temperature?.nightBand ?? null]} />
      <p className={`mono ${styles.verdictText}`}>{verdictSentence(t, verdict)}</p>
    </div>
  );
}

const OUTPUT_NAMES: Record<string, string> = { fanInternal: 'fan', fanExternal: 'exhaust', fanBackwall: 'fan' };

/** Whether any reading at all was heard in the window: a verdict with a band and no readings is a silent tent, not an unsteered one. */
const heardAnything = (verdict: ClimateVerdict): boolean => verdict.metrics.some(row => row.minValue !== null);

const verdictSentence = (t: Translate, verdict: ClimateVerdict): string => {
  if (verdict.rating === null || verdict.inBandFraction === null) {
    return t(heardAnything(verdict) || verdict.metrics.length === 0 ? 'space.verdict.noTarget' : 'space.verdict.noReadings');
  }

  const parts = [t('space.inBand', { percent: Math.round(verdict.inBandFraction * 100) })];

  for (const metric of verdict.metrics) {
    if (metric.excursions.length === 0) continue;
    const name = t(`space.verdict.metric.${metric.metric}`, { defaultValue: metric.metric });
    if (metric.excursions.length === 1) {
      const [one] = metric.excursions;
      const from = DateTime.fromISO(one.startedAt).toFormat('HH:mm');
      const to = one.endedAt ? DateTime.fromISO(one.endedAt).toFormat('HH:mm') : t('space.verdict.stillOut');
      parts.push(t('space.verdict.excursion', { metric: name, from, to }));
    } else {
      parts.push(t('space.verdict.excursions', { count: metric.excursions.length, metric: name }));
    }
  }

  for (const actuator of verdict.actuators.filter(row => row.output !== 'light' && row.runCount > 0)) {
    parts.push(
      t('space.verdict.ran', {
        output: t(`space.output.${OUTPUT_NAMES[actuator.output] ?? actuator.output}`, { defaultValue: actuator.output }),
        count: actuator.runCount,
      }),
    );
  }

  return parts.join(' · ');
};

type Band = { low: number; high: number } | null;

/**
 * The day's temperature as a line, with both bands it should sit in shaded
 * behind it: the line has no day and night of its own, so the night's dip is
 * shown against the night's band rather than looking like a fall out of the day's.
 */
function TrendLine({ verdict, bands }: { verdict: ClimateVerdict; bands: Band[] }) {
  const points = verdict.trend?.points ?? [];
  const known = points.filter((value): value is number => value !== null);
  if (known.length < 2) return <div className={styles.trend} aria-hidden />;

  const drawn = bands.filter((band): band is NonNullable<Band> => band !== null);
  const low = Math.min(...known, ...drawn.map(band => band.low)) - 0.5;
  const high = Math.max(...known, ...drawn.map(band => band.high)) + 0.5;
  const x = (index: number) => (index / (points.length - 1)) * WIDTH;
  const y = (value: number) => HEIGHT - ((value - low) / (high - low)) * HEIGHT;

  const parts: string[] = [];
  let broken = true;
  points.forEach((value, index) => {
    if (value === null) return void (broken = true);
    parts.push(`${broken ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`);
    broken = false;
  });

  return (
    <svg className={styles.trend} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden>
      {drawn.map(band => (
        <rect key={band.low} className={styles.band} x={0} y={y(band.high)} width={WIDTH} height={y(band.low) - y(band.high)} />
      ))}
      <path className={styles.line} d={parts.join(' ')} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
