import { Camera, Droplet, Leaf, Pencil, Ruler, Timer, type LucideIcon } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Entry, GrowCard, GrowthStage, HomeSpaceCard, Person } from '@fg2/shared-types/v1';
import { THUMBNAIL_WIDTH, useSession, mediaUrl } from '@/api/session';
import { ageLabel } from '@/ui/age';
import { authorOf, headlineOf } from '@/ui/entries';
import { quietMinutes, VISIT_MINUTES } from '@/ui/maintenance';
import { STAGES } from '@/ui/stages';
import { useLog, useMayLog, type TileKind } from '@/log/log-context';
import { MoveHereSheet } from '@/screens/space/MoveHereSheet';
import { useMayManage } from '@/ui/session-access';
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
          <LogAction kind="water" growId={grow.growId} Icon={Droplet} labelKey="home.actions.water" primary />
          <LogAction kind="note" growId={grow.growId} Icon={Pencil} labelKey="home.actions.note" />
          <LogAction kind="photo" growId={grow.growId} Icon={Camera} labelKey="home.actions.photo" />
        </div>
      )}
    </div>
  );
}

/** "Flower · wk 2 [auto] · Amnesia, Gelato · 3 plants" */
export function PhaseLine({ grow }: { grow: GrowCard }) {
  const { t } = useTranslation();
  return (
    <>
      {grow.stage ? (
        <span className={styles.phase}>
          {t(`home.stage.${grow.stage}`)}
          {grow.stageWeek !== null ? ` · ${t('home.card.week', { week: grow.stageWeek })}` : ''}
        </span>
      ) : (
        <span className={styles.phase}>{t('home.card.noPhase')}</span>
      )}
      {grow.isAuto ? <span className={`mono ${styles.auto}`}>{t('home.card.auto')}</span> : null}
      {grow.strains.length > 0 ? <span className={styles.strains}> · {grow.strains.join(', ')}</span> : null}
      {/* Null is a count the owner hides and zero is a record that carries no
          plants at all - a migrated diary has none by decision - so neither is
          drawn. "0 plants" reads as a grow whose plants all died. */}
      {grow.plantCount ? <span className={styles.strains}> · {t('home.card.plants', { count: grow.plantCount })}</span> : null}
    </>
  );
}

export function DayCounter({ day }: { day: number | null }) {
  const { t } = useTranslation();
  if (day === null) return null;

  return (
    <div className={styles.day}>
      <span className={`figure ${styles.dayFigure}`}>{day}</span>
      <span className="caption">{t('home.card.day')}</span>
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

/**
 * The grow half of a place that has no grow: one line, and the three ways out
 * of it. Both ways in name this card's place - the invitation is about this
 * tent, so the sheet it opens has to be about this tent too, and a sheet that
 * arrived with no subject would fall back to whatever grow the account has
 * running somewhere else.
 *
 * Both of them put a grow into this place, which is managing it: the server
 * asks for `manage` on the space both for the grow that is started there and
 * for the placement that moves one in, so below that the invitation is a
 * control that exists only to be refused. Somebody who may write lines here and
 * no more is left the plain line, which is the same thing this place's own
 * Overview draws - and it is that page, not every card of a club, that says in
 * words what they may do instead. "Not now" goes with the two: it is the answer
 * to an invitation, and there is none here to put off.
 */
export function NoGrow({ card, onNotNow }: { card: HomeSpaceCard; onNotNow: () => void }) {
  const { t } = useTranslation();
  const [moving, setMoving] = useState(false);
  // What may be done here is a fact about this place and not about the session:
  // the same account owns the tent above this one and only logs in this.
  const mayManage = useMayManage(card.spaceId);

  if (!mayManage) return <p className={styles.invite}>{t('home.invite.noGrow')}</p>;

  return (
    <>
      <p className={styles.invite}>
        {t('home.invite.noGrow')}
        {' · '}
        <Link to={`/grows/new?space=${card.spaceId}`} className={styles.inviteAction}>
          {t('home.invite.startGrow')}
        </Link>
        {' · '}
        <button type="button" className={styles.inviteAction} onClick={() => setMoving(true)}>
          {t('home.invite.moveGrow')}
        </button>
        {' · '}
        <button type="button" className={styles.inviteDismiss} onClick={onNotNow} aria-label={t('home.invite.notNowFor', { name: card.name })}>
          {t('home.invite.notNow')}
        </button>
      </p>
      {moving && card.spaceId !== null ? <MoveHereSheet spaceId={card.spaceId} spaceName={card.name} onClose={() => setMoving(false)} /> : null}
    </>
  );
}

/** A reading taken by hand, where nothing measures by itself. */
function LogReading() {
  const { t } = useTranslation();
  const { openSheet } = useLog();

  return (
    <button type="button" className={styles.inviteAction} onClick={() => openSheet({ kind: 'measurement' })}>
      {t('home.invite.logReading')}
    </button>
  );
}

/** The climate half of a place with nothing measuring in it. */
export function NoSensor() {
  const { t } = useTranslation();
  const mayLog = useMayLog();

  return (
    <p className={styles.invite}>
      {t('home.invite.noSensor')}
      {mayLog ? (
        <>
          {' · '}
          <LogReading />
        </>
      ) : null}
      {' · '}
      <Link to="/devices" className={styles.inviteAction}>
        {t('home.invite.addDevice')}
      </Link>
    </p>
  );
}

/**
 * One of the two or three things a person does most, on the card of the place
 * they do it to. It opens the Log sheet at that tile over the home rather than
 * going anywhere: the card is where you were, and where you want to be after.
 */
function LogAction({
  kind,
  growId = null,
  spaceId = null,
  Icon,
  labelKey,
  values,
  primary = false,
}: {
  kind: TileKind;
  growId?: string | null;
  spaceId?: string | null;
  Icon: LucideIcon;
  labelKey: string;
  /** What the label interpolates, for the one chip whose words carry a span. */
  values?: Record<string, unknown>;
  primary?: boolean;
}) {
  const { t } = useTranslation();
  const { openSheet } = useLog();
  const mayLog = useMayLog();

  if (!mayLog) return null;

  return (
    <button
      type="button"
      className={[ui.button, primary ? ui.primary : ui.quiet, styles.action].join(' ')}
      onClick={() => openSheet({ kind, growId, spaceId })}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden />
      {t(labelKey, values)}
    </button>
  );
}

/** What a device-only tent offers: a picture, a note, a quarter hour of presence. */
export function DeviceActions({ card }: { card: HomeSpaceCard }) {
  return (
    <div className={styles.actions}>
      <LogAction kind="photo" spaceId={card.spaceId} Icon={Camera} labelKey="home.actions.photo" />
      <LogAction kind="note" spaceId={card.spaceId} Icon={Pencil} labelKey="home.actions.note" />
      <LogAction
        kind="visit"
        spaceId={card.spaceId}
        Icon={Timer}
        labelKey="home.actions.visit"
        values={{ quiet: quietMinutes(VISIT_MINUTES * 60) }}
      />
    </div>
  );
}

/** What a diary-only grow offers in place of the climate: water, a picture, a reading by hand. */
export function DiaryActions({ grow }: { grow: GrowCard }) {
  return (
    <div className={styles.actions}>
      <LogAction kind="water" growId={grow.growId} Icon={Droplet} labelKey="home.actions.water" />
      <LogAction kind="photo" growId={grow.growId} Icon={Camera} labelKey="home.actions.photo" />
      <LogAction kind="measurement" growId={grow.growId} Icon={Ruler} labelKey="home.actions.reading" />
    </div>
  );
}
