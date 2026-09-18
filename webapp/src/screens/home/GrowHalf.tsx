import { Camera, Droplet, Leaf, Pencil, Ruler, Timer } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Entry, GrowCard, GrowthStage, HomeSpaceCard, Person } from '@fg2/shared-types/v1';
import { THUMBNAIL_WIDTH, useSession, mediaUrl } from '@/api/session';
import { ageLabel } from '@/ui/age';
import { authorOf, headlineOf } from '@/ui/entries';
import { STAGES } from '@/ui/stages';
import ui from '@/ui/ui.module.css';
import styles from './SpaceCard.module.css';

interface GrowHalfProps {
  card: HomeSpaceCard;
  people: Person[];
  now: DateTime;
  /** The grow is the card's header already, so the row below repeats neither its name nor its counter. */
  headed: boolean;
  /** A club's card: no phase bar, the row is what fits. */
  compact: boolean;
}

/**
 * The grow half: the day counter, the phase with its "auto" tag when a preset
 * or a plan set it, the strains, the newest line of the diary with who wrote
 * it, and the two or three things a person does most.
 */
export function GrowHalf({ card, people, now, headed, compact }: GrowHalfProps) {
  const { t } = useTranslation();
  const grow = card.grow!;
  // A grow without a cover of its own is shown by the newest picture of where it stands.
  const coverId = grow.coverMediaId ?? card.latestStill?.mediaId ?? null;
  const cover = coverId ? mediaUrl(coverId, THUMBNAIL_WIDTH.cover) : null;

  return (
    <div className={styles.grow}>
      {headed ? null : (
        <Link to={`/grows/${grow.growId}`} className={styles.growRow}>
          <span className={styles.cover}>{cover ? <img src={cover} alt="" /> : <Leaf size={22} strokeWidth={1.5} aria-hidden />}</span>
          <div className={styles.growText}>
            <div className={styles.growName}>{grow.name}</div>
            <div className={styles.growLine}>
              <PhaseLine grow={grow} />
            </div>
          </div>
          <DayCounter day={grow.dayNumber} />
        </Link>
      )}
      <NewestEntry entry={card.entries[0] ?? null} people={people} now={now} />
      {compact || grow.stage === null ? null : <PhaseBar stage={grow.stage} />}
      {headed ? (
        <DiaryActions grow={grow} />
      ) : (
        <div className={styles.actions}>
          <Link to={`/log?kind=water&grow=${grow.growId}`} className={`${ui.button} ${ui.primary} ${styles.action}`}>
            <Droplet size={16} strokeWidth={1.75} aria-hidden />
            {t('home.actions.water')}
          </Link>
          <Link to={`/log?kind=note&grow=${grow.growId}`} className={`${ui.button} ${styles.action}`}>
            <Pencil size={16} strokeWidth={1.75} aria-hidden />
            {t('home.actions.note')}
          </Link>
          <Link to={`/log?kind=photo&grow=${grow.growId}`} className={`${ui.button} ${styles.action}`}>
            <Camera size={16} strokeWidth={1.75} aria-hidden />
            {t('home.actions.photo')}
          </Link>
        </div>
      )}
    </div>
  );
}

/** "Flower · wk 2 [auto] · Amnesia, Gelato · 3 plants" */
export function PhaseLine({ grow }: { grow: GrowCard }) {
  const { t } = useTranslation();
  const week = grow.phaseDay === null ? null : Math.floor((grow.phaseDay - 1) / 7) + 1;

  return (
    <>
      {grow.stage ? (
        <span className={styles.phase}>
          {t(`home.stage.${grow.stage}`)}
          {week !== null ? ` · ${t('home.card.week', { week })}` : ''}
        </span>
      ) : (
        <span className={styles.phase}>{t('home.card.noPhase')}</span>
      )}
      {grow.isAuto ? <span className={`mono ${styles.auto}`}>{t('home.card.auto')}</span> : null}
      {grow.strains.length > 0 ? <span className={styles.strains}> · {grow.strains.join(', ')}</span> : null}
      {grow.plantCount !== null ? <span className={styles.strains}> · {t('home.card.plants', { count: grow.plantCount })}</span> : null}
    </>
  );
}

export function DayCounter({ day }: { day: number | null }) {
  const { t } = useTranslation();
  if (day === null) return null;

  return (
    <div className={styles.day}>
      <span className={`figure ${styles.dayFigure}`}>{day}</span>
      <span className="label">{t('home.card.day')}</span>
    </div>
  );
}

/**
 * Where the grow is on its way: the stages as segments, filled up to the one
 * it is in, whose name sits under it. No durations are known here - the
 * scheme and the plan are what would give the segments their length - so the
 * bar says which stage, and the day counter says how long.
 */
export function PhaseBar({ stage }: { stage: GrowthStage }) {
  const { t } = useTranslation();
  const current = STAGES.indexOf(stage);

  return (
    <div className={styles.phaseBar} aria-hidden>
      <div className={styles.segments}>
        {STAGES.map((name, index) => (
          <span key={name} className={styles.segment} data-reached={index <= current} />
        ))}
      </div>
      <div className={`mono ${styles.stageLabels}`}>
        <span style={{ left: `${(current / STAGES.length) * 100}%` }}>{t(`home.stage.${stage}`)}</span>
        {current < STAGES.length - 1 ? <span className={styles.stageEnd}>{t(`home.stage.${STAGES[STAGES.length - 1]}`)}</span> : null}
      </div>
    </div>
  );
}

/** "Defoliated · 1 d ago · you" - a person's own words, or what a device or the plan wrote, and who. */
export function NewestEntry({ entry, people, now }: { entry: Entry | null; people: Person[]; now: DateTime }) {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  if (!entry) return <p className={`${styles.entry} ${styles.entryEmpty}`}>{t('home.card.noEntries')}</p>;

  const headline = headlineOf(t, i18n, entry);
  const author = authorOf(t, entry, people, user?.id);

  return (
    <p className={styles.entry}>
      <span className={styles.entryText}>{headline}</span>
      <span className={`mono ${styles.entryMeta}`}>
        {' '}
        · {t('home.card.ago', { age: ageLabel(entry.occurredAt, now) })} · {author}
      </span>
    </p>
  );
}

/** The grow half of a place that has no grow: one line, and the three ways out of it. */
export function NoGrow({ card, onNotNow }: { card: HomeSpaceCard; onNotNow: () => void }) {
  const { t } = useTranslation();

  return (
    <p className={styles.invite}>
      {t('home.invite.noGrow')}
      {' · '}
      <Link to="/log?kind=phase" className={styles.inviteAction}>
        {t('home.invite.startGrow')}
      </Link>
      {' · '}
      <Link to="/log?kind=move" className={styles.inviteAction}>
        {t('home.invite.moveGrow')}
      </Link>
      {' · '}
      <button type="button" className={styles.inviteDismiss} onClick={onNotNow} aria-label={t('home.invite.notNowFor', { name: card.name })}>
        {t('home.invite.notNow')}
      </button>
    </p>
  );
}

/** The climate half of a place with nothing measuring in it. */
export function NoSensor() {
  const { t } = useTranslation();

  return (
    <p className={styles.invite}>
      {t('home.invite.noSensor')}
      {' · '}
      <Link to="/log?kind=measurement" className={styles.inviteAction}>
        {t('home.invite.logReading')}
      </Link>
      {' · '}
      <Link to="/devices" className={styles.inviteAction}>
        {t('home.invite.addDevice')}
      </Link>
    </p>
  );
}

/** What a device-only tent offers: a picture, a note, a quarter hour of presence. */
export function DeviceActions({ card }: { card: HomeSpaceCard }) {
  const { t } = useTranslation();

  return (
    <div className={styles.actions}>
      <Link to={`/log?kind=photo&space=${card.spaceId}`} className={`${ui.button} ${styles.action}`}>
        <Camera size={16} strokeWidth={1.75} aria-hidden />
        {t('home.actions.photo')}
      </Link>
      <Link to={`/log?kind=note&space=${card.spaceId}`} className={`${ui.button} ${styles.action}`}>
        <Pencil size={16} strokeWidth={1.75} aria-hidden />
        {t('home.actions.note')}
      </Link>
      <Link to={`/log?kind=visit&space=${card.spaceId}`} className={`${ui.button} ${styles.action}`}>
        <Timer size={16} strokeWidth={1.75} aria-hidden />
        {t('home.actions.visit')}
      </Link>
    </div>
  );
}

/** What a diary-only grow offers in place of the climate: water, a picture, a reading by hand. */
export function DiaryActions({ grow }: { grow: GrowCard }) {
  const { t } = useTranslation();

  return (
    <div className={styles.actions}>
      <Link to={`/log?kind=water&grow=${grow.growId}`} className={`${ui.button} ${styles.action}`}>
        <Droplet size={16} strokeWidth={1.75} aria-hidden />
        {t('home.actions.water')}
      </Link>
      <Link to={`/log?kind=photo&grow=${grow.growId}`} className={`${ui.button} ${styles.action}`}>
        <Camera size={16} strokeWidth={1.75} aria-hidden />
        {t('home.actions.photo')}
      </Link>
      <Link to={`/log?kind=measurement&grow=${grow.growId}`} className={`${ui.button} ${styles.action}`}>
        <Ruler size={16} strokeWidth={1.75} aria-hidden />
        {t('home.actions.reading')}
      </Link>
    </div>
  );
}
