import { Globe } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import type { GrowListItem, Plant, Space } from '@fg2/shared-types/v1';
import { useGrow, useGrowPlants } from '@/api/grows';
import { noLongerThere } from '@/api/problem';
import { useSpaces } from '@/api/spaces';
import { ALL_GROWS, GROW, placePath, usePageOfGrow } from '@/app/places';
import { Term } from '@/ui/Help';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { enough, growStanding, standsIn, useMayWith } from '@/ui/session-access';
import { AlsoHere } from '@/screens/space/AlsoHere';
import { stageLabel } from '@/ui/presets';
import { Tabs } from '@/ui/Tabs';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { calendarDay, useZone } from '@/ui/zone';
import { Diary } from './diary/Diary';
import { Feeding } from './Feeding';
import { GrowBar } from './GrowBar';
import { GrowMenu } from './GrowMenu';
import { GROW_TABS, growTabOf, growTabPath, type GrowTab } from './grow-tabs';
import { Pictures } from './pictures/Pictures';
import { lastPlaceOf, placeName } from './placement';
import { Plants } from './Plants';
import { Report } from './Report';
import styles from './GrowPage.module.css';

/** A grow opened by its id: every grow of "Alle Grows" - a finished one, one of another place, somebody else's. */
export function GrowPage() {
  const { growId = '', tab: segment } = useParams();
  const tab = growTabOf(segment);
  if (tab === null) return <Navigate to={`/grows/${growId}`} replace />;

  return <GrowScreen growId={growId} tab={tab} />;
}

/**
 * A grow's page: its name, how far it has come and where it stands, then the
 * diary and its other tabs. The grow is one read and the tabs read their own;
 * a refresh that fails keeps what was known on the screen and says so.
 *
 * `current` is the grow drawn at the bar's own address, as the one running in
 * the chosen place; opened by its id, a running grow's page belongs to the
 * place it stands in. The page is the same under both: Grow is a root of the
 * bar, so nothing leads back from it, and "Alle Grows" stands beside its name.
 */
export function GrowScreen({ growId, tab, current = false }: { growId: string; tab: GrowTab; current?: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const grow = useGrow(growId);
  usePageOfGrow(current ? undefined : grow.data);
  const plants = useGrowPlants(growId);
  const spaces = useSpaces();
  const mayWith = useMayWith();
  // "Grow teilen" in a place's menu opens the grow on its share sheet.
  const [params] = useSearchParams();

  // While the grow is on its way the page is already Grow, under its own heading.
  if (grow.isPending) {
    return (
      <NoGrow>
        <Waiting lines={2} />
        <Waiting lines={4} />
      </NoGrow>
    );
  }
  if (!grow.data) {
    return noLongerThere(grow.error) ? (
      <NoSuchGrow />
    ) : (
      <NoGrow>
        <LoadFailed read={grow} />
      </NoGrow>
    );
  }

  // A grow is written to through the place it stands in today, which is what
  // `access()` widens a membership over; the lifecycle moves are `manage` there
  // and putting the diary on the open web is the owner's alone.
  const youMay = mayWith(growStanding(grow.data));
  const mayManage = enough(youMay, 'manage');
  const mayOwn = enough(youMay, 'own');
  const base = current ? GROW : `/grows/${growId}`;
  const tabs = GROW_TABS.map(key => ({ key, label: t(`grow.tabs.${key}`), to: growTabPath(base, key), end: key === 'diary' }));

  return (
    <section className={`${ui.stack3} ${styles.page}`} data-tab={tab}>
      <GrowHead grow={grow.data} plants={plants.data?.items ?? []} spaces={spaces.data?.items ?? []}>
        <GrowMenu
          grow={grow.data}
          plants={plants.data?.items ?? []}
          spaces={spaces.data?.items ?? []}
          mayManage={mayManage}
          mayOwn={mayOwn}
          sharing={params.get('share') === '1'}
        />
      </GrowHead>
      <RefreshFailed failedAt={grow.isError ? grow.dataUpdatedAt : null} now={now} />
      <AlsoHere growId={growId} spaceId={grow.data.endedAt === null ? standsIn(grow.data) : null} />
      <Tabs items={tabs} label={t('grow.tabsLabel')} />
      {tab === 'diary' ? <Diary grow={grow.data} now={now} picturesTo={growTabPath(base, 'pictures')} /> : null}
      {tab === 'pictures' ? <Pictures grow={grow.data} now={now} /> : null}
      {tab === 'plants' ? <Plants grow={grow.data} plants={plants} spaces={spaces.data?.items ?? []} mayManage={mayManage} /> : null}
      {tab === 'feeding' ? <Feeding grow={grow.data} mayManage={mayManage} /> : null}
      {tab === 'report' ? (
        <Report grow={grow.data} spaces={spaces.data?.items ?? []} mayOwn={mayOwn} now={now} picturesTo={growTabPath(base, 'pictures')} />
      ) : null}
    </section>
  );
}

/** Grow where no grow is drawn: the page's own heading with the way to every grow, over what it says instead. */
export function NoGrow({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <section className={`${ui.stack3} ${styles.page}`}>
      <header className={styles.head}>
        <div className={styles.title}>
          <h1>{t('shell.tabs.grow')}</h1>
          <div className={styles.actions}>
            <Link to={ALL_GROWS} className={`${ui.pill} ${styles.pill}`}>
              {t('grow.all.pill')}
            </Link>
          </div>
        </div>
      </header>
      {children}
    </section>
  );
}

/** An address that names no grow this account can open says so, with the two causes that can have. */
function NoSuchGrow() {
  const { t } = useTranslation();

  return (
    <NoGrow>
      <p className={ui.problem} role="alert">
        {t('shell.gone.grow')}
      </p>
      <p className={ui.note}>{t('shell.gone.why')}</p>
    </NoGrow>
  );
}

/**
 * The head of the page: what the grow is called, the day and the phase it is
 * in over the bar of how far it has come, and where it stands - with the way
 * to every grow and, as `children`, what can be done to this one.
 *
 * A grow that has ended says so here rather than drawing the shape of a
 * running one: how many days it ran and the date it ended, and where it last
 * stood said in the past tense - its placements are all closed, and "no fixed
 * place" would be wrong of a grow that spent its life in a tent.
 */
export function GrowHead({ grow, plants, spaces, children = null }: { grow: GrowListItem; plants: Plant[]; spaces: Space[]; children?: ReactNode }) {
  const { t } = useTranslation();
  const zone = useZone();
  const { summary } = grow;
  // The date is read where the account is: the day a grow ended on moves with the zone.
  const endedOn = grow.endedAt ? calendarDay(grow.endedAt, zone) : null;
  // A grow that has ended says how long it ran and when it ended; a running one its day and its phase, each explained where it is met.
  const stage = summary.stage ? stageLabel(t, summary.stage, summary.preset) : t('home.card.noPhase');
  const places = summary.locations.map(location => ({ spaceId: location.spaceId, name: placeName(t, spaces, location.spaceId) }));
  const stood = places.length > 0 ? null : lastPlaceOf(grow);
  // Plants gone their own way are said beside the stage most of the grow is in - those still standing by their
  // stage, and one that was cut as harvested: it is in no stage any more. A grow that has ended has none standing.
  const gone = new Set(plants.filter(plant => plant.status !== 'active').map(plant => plant.id));
  const harvested = plants.filter(plant => plant.status === 'harvested').length;
  const stages = summary.groups
    .map(group => ({ stage: group.stage, count: group.plantIds.filter(id => !gone.has(id)).length }))
    .filter(group => group.count > 0);
  const standing = endedOn
    ? []
    : [
        ...(stages.length > 1 ? stages.map(group => `${group.count} ${t(`home.stage.${group.stage}`)}`) : []),
        ...(harvested > 0 && harvested < plants.length ? [t('grow.harvestedCount', { count: harvested })] : []),
      ];
  const where = stood ? [{ spaceId: stood.spaceId, name: t('grow.stoodIn', { name: placeName(t, spaces, stood.spaceId) }) }] : places;
  return (
    <header className={styles.head}>
      <div className={styles.title}>
        {/* The grow's menu and the way to every grow are the app around the record, and stay off its paper. On a
            phone they are a row of their own over the name, which then has its line to itself. */}
        <div className={styles.actions} data-print="omit">
          <Link to={ALL_GROWS} className={`${ui.pill} ${styles.pill}`}>
            {t('grow.all.pill')}
          </Link>
          {children}
        </div>
        <h1>{grow.name}</h1>
        <p className={styles.facts}>
          <span>
            {endedOn ? (
              [summary.dayNumber !== null ? t('grow.days', { count: summary.dayNumber }) : null, t('grow.ended', { date: endedOn })]
                .filter(Boolean)
                .join(' · ')
            ) : (
              <>
                {summary.dayNumber !== null ? (
                  <>
                    <Term topic="growDay">{t('home.card.dayN', { day: summary.dayNumber })}</Term>
                    {' · '}
                  </>
                ) : null}
                {stage}
                {summary.stage && summary.stageWeek !== null ? (
                  <>
                    {', '}
                    <Term topic="growWeek">{t('grow.week', { week: summary.stageWeek })}</Term>
                  </>
                ) : null}
              </>
            )}
            {summary.isAuto && !endedOn ? (
              <>
                {' · '}
                <Term topic="autoTag">{t('home.card.auto')}</Term>
              </>
            ) : null}
            {standing.length > 0 ? ` · ${standing.join(', ')}` : ''}
            {grow.visibility === 'public' ? (
              <>
                {' · '}
                <Link to={`/g/${grow.slug}`} className={styles.public}>
                  <Globe size={12} strokeWidth={2} aria-hidden />
                  {t('sharing.publicChip')}
                </Link>
              </>
            ) : null}
          </span>
          {where.length > 0 ? (
            <span className={styles.where}>
              {where.map((place, index) => (
                <span key={place.spaceId ?? 'none'}>
                  {index > 0 ? ', ' : ''}
                  {place.spaceId ? <Link to={placePath(place.spaceId)}>{place.name}</Link> : place.name}
                </span>
              ))}
            </span>
          ) : null}
        </p>
      </div>
      <GrowBar
        grow={{ growId: grow.id, stage: summary.stage, dayNumber: summary.dayNumber }}
        label={
          summary.stage
            ? t(endedOn ? 'grow.phaseBarEndedLabel' : 'grow.phaseBarLabel', { stage: t(`home.stage.${summary.stage}`) })
            : t('home.card.noPhase')
        }
      />
    </header>
  );
}
