import { Camera, Droplet, Flag, FlaskConical, Gauge, Pencil, TrendingUp, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRecentEntries } from '@/api/entries';
import { useGrow, useGrowPlants, useGrows } from '@/api/grows';
import { useHome } from '@/api/home';
import { enough, growStanding, useMayWith } from '@/ui/session-access';
import { Choice } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { TILE_KINDS, useLog, type LogOpening, type LogTarget, type TileKind } from './log-context';
import { Moment } from './Moment';
import { useGrowBegins } from './defaults';
import { narrowerTargets, openingTarget, placeChip, targetsOf } from './targets';
import { Sheet } from '@/ui/Sheet';
import styles from './Log.module.css';

/**
 * The entry sheet: what the line is about, the seven things it can be, and
 * when it happened.
 *
 * A tap on a tile opens its view, filled in with what was done last time, and
 * Save there writes it. Nothing is written straight off a tile and nothing
 * hides behind a long press (Chris, 2026-10-21). When it happened is asked
 * here, at the sheet's foot, for a line written after the fact; the view it
 * opens shows that moment in its corner, where it can still be changed.
 */

const ICONS: Partial<Record<TileKind, LucideIcon>> = {
  water: Droplet,
  feed: FlaskConical,
  photo: Camera,
  note: Pencil,
  measurement: Gauge,
  training: TrendingUp,
  phase: Flag,
};

interface LogSheetProps {
  opening: LogOpening;
  /** What was chosen last time, so the sheet opens where it was left when nothing else says otherwise. */
  lastKey: string | null;
  onChosen: (key: string) => void;
  onClose: () => void;
}

export function LogSheet({ opening, lastKey, onChosen, onClose }: LogSheetProps) {
  const { t } = useTranslation();
  const { openDetails } = useLog();
  const { data: home, isPending } = useHome();
  const mayWith = useMayWith();

  // Two choices, because the second one lives inside the first: which place -
  // which grow, where two grow in one - and whether the line is about the tent
  // or one plant of it rather than the whole grow. Changing the place drops
  // the narrower choice with it.
  // The home names the newer grow of a place alone; until the list of grows is read too, nothing is offered to
  // tap that could be the wrong one of two.
  const grows = useGrows();
  const places = useMemo(() => (grows.isPending ? [] : targetsOf(home, grows.data?.items)), [home, grows.isPending, grows.data]);
  const [placeKey, setPlaceKey] = useState<string | null>(null);
  const [narrowKey, setNarrowKey] = useState<string | null>(null);
  // When the line happened, or null for now: asked once here, for whichever kind is then chosen.
  const [at, setAt] = useState<Date | null>(null);
  const aim = useMemo(() => openingTarget(places, opening, lastKey), [places, opening, lastKey]);
  // The chip the sheet opened on is held until somebody presses another: a grow's start moved from the sheet's foot
  // makes the other grow of its place the newer one, and the line must not follow it there.
  if (placeKey === null && aim.target) setPlaceKey(aim.target.key);
  const place = useMemo(() => places.find(one => one.key === placeKey) ?? aim.target, [places, placeKey, aim]);
  // A link that named a subject nothing here is leaves the sheet unaimed rather
  // than aimed at somebody else's grow, so it has to say why it is unaimed: the
  // tiles are dead until a chip is pressed, and an unexplained dead sheet is
  // read as a broken one.
  const missed = aim.missed && place === null;

  const { data: grow } = useGrow(place?.growId ?? null);
  const { data: plants } = useGrowPlants(place?.growId ?? null);
  const { isLoading: loadingDefaults } = useRecentEntries(place?.growId ?? null, place?.spaceId ?? null);

  const narrower = useMemo(() => narrowerTargets(place, plants?.items ?? []), [place, plants]);
  const target = narrower.find(one => one.key === narrowKey) ?? place;
  // One tent and no plants to tell apart is one thing a line can be about: nothing to choose, so no chips.
  const several = places.length > 1;
  const choosable = several || narrower.length > 0 || (place !== null && place.growId === null);
  const begins = useGrowBegins(grow, target);
  // Six of the seven tiles write a diary line, which is what a membership to
  // log is for. A phase is the one that is not: it moves the grow to another
  // stage and puts the tent's climate on it, which the decision record keeps at
  // `manage` where the grow stands - so in a tent somebody only writes in, that
  // tile is not there rather than there and refused. A reading is written
  // against a grow's own measurements, so a tent with nothing growing in it
  // has nothing to measure and is not offered that tile.
  const mayStartAPhase = grow ? enough(mayWith(growStanding(grow)), 'manage') : false;
  const tiles = TILE_KINDS.filter(kind => (kind === 'measurement' ? Boolean(target?.growId) : kind === 'phase' ? mayStartAPhase : true));

  // A view opens on what was done last time, so until those lines are here a tile opens nothing.
  const ready = Boolean(target) && !loadingDefaults;

  const choose = (one: LogTarget, narrower: boolean) => {
    if (narrower) return setNarrowKey(key => (key === one.key ? null : one.key));
    onChosen(one.key);
    setPlaceKey(one.key);
    setNarrowKey(null);
  };

  // A link that named a tile - a card's Water, a notification's Feed - opens it
  // as soon as there is something to write it against, and only once.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !opening.kind || !target || !ready) return;
    asked.current = true;
    openDetails(opening.kind, target, null, null, target.growId === opening.growId ? opening.taskId : null);
  }, [opening.kind, opening.growId, opening.taskId, target, ready, openDetails]);

  const details = (kind: TileKind) => {
    if (target && ready) openDetails(kind, target, null, at);
  };

  return (
    <Sheet title={t('log.title')} onClose={onClose}>
      {places.length === 0 ? (
        <p className={ui.note}>{isPending || grows.isPending ? t('home.waiting') : t('log.nowhere')}</p>
      ) : (
        <>
          {missed ? (
            <p className={ui.problem} role="alert">
              {t('log.notHere')}
            </p>
          ) : null}
          {/* The places in one row, and under it the plants of the chosen one: which place, then whether the line
              is about one plant of it. Pressed rather than linked, so the sheet stays where it is. */}
          {choosable || missed ? (
            <div className={`${ui.wrap} ${styles.targets}`} role="group" aria-label={t('log.targetLabel')}>
              {places.map(one => (
                <Choice key={one.key} chosen={one.key === place?.key} onChoose={() => choose(one, false)}>
                  {several ? placeChip(home, one) : one.label}
                </Choice>
              ))}
            </div>
          ) : null}
          {narrower.length > 0 ? (
            <div className={`${ui.wrap} ${styles.targets}`} role="group" aria-label={t('log.plantLabel')}>
              {narrower.map(one => (
                <Choice key={one.key} chosen={one.key === target?.key} onChoose={() => choose(one, true)}>
                  {one.label}
                </Choice>
              ))}
            </div>
          ) : null}

          <div className={styles.tiles}>
            {tiles.map(kind => {
              const Icon = ICONS[kind];
              return (
                <button key={kind} type="button" className={styles.tile} disabled={!ready} onClick={() => details(kind)}>
                  {Icon ? <Icon size={22} strokeWidth={2} className={styles.tileIcon} aria-hidden /> : null}
                  {t(`log.tile.${kind}`)}
                </button>
              );
            })}
          </div>

          <Moment at={at} onChange={setAt} row begins={begins} />
        </>
      )}
    </Sheet>
  );
}
