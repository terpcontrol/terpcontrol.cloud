import { Camera, ChartNoAxesColumn, Droplet, FlaskConical, Leaf, Pencil, Scissors, Wrench, type LucideIcon } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem } from '@fg2/shared-types/v1';
import { useRecentEntries, writeEntry } from '@/api/entries';
import { useGrow, useGrowPlants } from '@/api/grows';
import { useHome } from '@/api/home';
import type { Translate } from '@/i18n/i18n';
import { livenessOf } from '@/screens/home/attention';
import { ageLabel } from '@/ui/age';
import { VISIT_MINUTES } from '@/ui/maintenance';
import { enough, growStanding, useMayWith } from '@/ui/session-access';
import { Choice } from '@/ui/SheetParts';
import { useNow } from '@/ui/useNow';
import ui from '@/ui/ui.module.css';
import { lastCan, newestOf, nextStage, schemeStep } from './defaults';
import { lineLabel, oneTapBody } from './lines';
import { TILE_KINDS, useLog, type LogOpening, type LogTarget, type TileKind } from './log-context';
import { narrowerTargets, openingTarget, targetsOf } from './targets';
import { Sheet } from '@/ui/Sheet';
import { looseFigure } from '@/ui/figures';
import styles from './Log.module.css';

/**
 * The Log sheet: what the line is about, and the eight things it can be.
 *
 * One tap writes with what was done last time and the toast offers Undo; a tile
 * nothing can be guessed for - a picture, words, a reading, a phase - opens its
 * own view rather than writing something empty. Every tile opens that view on a
 * long press, which is what the board's caption says.
 */

/** How long a tile is held before it opens its details instead of logging. */
const HOLD_MS = 450;

const ICONS: Record<TileKind, LucideIcon> = {
  water: Droplet,
  feed: FlaskConical,
  photo: Camera,
  note: Pencil,
  measurement: ChartNoAxesColumn,
  training: Scissors,
  phase: Leaf,
  visit: Wrench,
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
  const now = useNow();
  const { log, openDetails } = useLog();
  const { data: home, isPending } = useHome();
  const mayWith = useMayWith();

  // Two choices, because the second one lives inside the first: which place,
  // and whether the line is about the tent or one plant of it rather than the
  // whole grow. Changing the place drops the narrower choice with it.
  const places = useMemo(() => targetsOf(home), [home]);
  const [placeKey, setPlaceKey] = useState<string | null>(null);
  const [narrowKey, setNarrowKey] = useState<string | null>(null);
  const aim = useMemo(() => openingTarget(places, opening, lastKey), [places, opening, lastKey]);
  const place = useMemo(() => places.find(one => one.key === placeKey) ?? aim.target, [places, placeKey, aim]);
  // A link that named a subject nothing here is leaves the sheet unaimed rather
  // than aimed at somebody else's grow, so it has to say why it is unaimed: the
  // tiles are dead until a chip is pressed, and an unexplained dead sheet is
  // read as a broken one.
  const missed = aim.missed && place === null;

  const { data: grow } = useGrow(place?.growId ?? null);
  const { data: plants } = useGrowPlants(place?.growId ?? null);
  const { data: recent, isLoading: loadingDefaults } = useRecentEntries(place?.growId ?? null, place?.spaceId ?? null);

  const narrower = useMemo(() => narrowerTargets(home, place, plants?.items ?? []), [home, place, plants]);
  const target = narrower.find(one => one.key === narrowKey) ?? place;
  const entries = recent?.items ?? [];
  // Seven of the eight tiles write a diary line, which is what a membership to
  // log is for. A phase is the one that is not: it moves the grow to another
  // stage and puts the tent's climate on it, which the decision record keeps at
  // `manage` where the grow stands - so in a tent somebody only writes in, that
  // tile is not there rather than there and refused.
  const mayStartAPhase = grow ? enough(mayWith(growStanding(grow)), 'manage') : false;
  // A reading is written against a grow's own measurements, so a tent with
  // nothing growing in it has nothing to measure and is not offered the tile.
  // Maintenance is offered where something would hear it: a place whose
  // hardware is reporting, and not one that is offline or has none at all.
  const card = home?.spaces.find(one => one.spaceId !== null && one.spaceId === (target?.standsIn ?? target?.spaceId)) ?? null;
  const reachable = card !== null && livenessOf(card, now) !== 'offline' && livenessOf(card, now) !== 'none';
  const tiles = TILE_KINDS.filter(kind =>
    kind === 'measurement' ? Boolean(target?.growId) : kind === 'phase' ? mayStartAPhase : kind === 'visit' ? reachable : true,
  );

  // A tile says what it is about to write - "2 L · last 3 d" - and one tap
  // writes exactly that, so until the lines it reads that off are here it
  // promises nothing and logs nothing.
  const ready = Boolean(target) && !loadingDefaults;

  const lastWater = newestOf(entries, 'water');
  const lastFeed = newestOf(entries, 'feed');
  const waterLitres = lastCan(entries, 'water');
  const feedLitres = lastCan(entries, 'feed');

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
    openDetails(opening.kind, target);
  }, [opening.kind, target, ready, openDetails]);

  const timer = useRef<number | null>(null);
  const held = useRef(false);

  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const details = (kind: TileKind) => {
    if (target && ready) openDetails(kind, target);
  };

  const tap = (kind: TileKind) => {
    if (!target || !ready) return;
    // Only water, and a feed with a can to dose by, are written on a tap. The
    // other tiles have nothing to guess - a picture, words, a reading, a phase,
    // what was trained on which plant - and a visit also puts every device in
    // the place into maintenance, which the toast's Undo does not call off, so
    // each of them opens its panel instead.
    if (kind !== 'water' && (kind !== 'feed' || feedLitres === null)) return details(kind);

    log({
      label: lineLabel(t, kind, target),
      details: { kind, target },
      send: () => writeEntry(oneTapBody(kind, target, kind === 'water' ? waterLitres : feedLitres)),
    });
  };

  const caption = (kind: TileKind): string => {
    switch (kind) {
      case 'water':
        return [waterLitres === null ? '' : t('log.litres', { litres: looseFigure(waterLitres) }), lastAgo(t, lastWater, now)]
          .filter(Boolean)
          .join(' · ');
      case 'feed':
        return feedCaption(t, grow, now) || lastAgo(t, lastFeed, now);
      case 'photo':
        return t(card?.latestStill ? 'log.tile.photoCaption' : 'log.tile.photoCaptionPhone');
      case 'measurement':
        return measureCaption(grow);
      case 'phase': {
        const next = nextStage(grow);
        return next ? `→ ${t(`home.stage.${next}`)}` : '';
      }
      case 'visit':
        return t('log.tile.visitCaption');
      default:
        return '';
    }
  };

  return (
    <Sheet title={t('log.title')} aside={t(touch() ? 'log.longPress' : 'log.rightClick')} onClose={onClose}>
      {places.length === 0 ? (
        <p className={ui.note}>{isPending ? t('home.waiting') : t('log.nowhere')}</p>
      ) : (
        <>
          {missed ? (
            <p className={ui.problem} role="alert">
              {t('log.notHere')}
            </p>
          ) : null}
          <div className={`${ui.scrollRow} ${styles.targets}`} role="group" aria-label={t('log.targetLabel')}>
            {/* The place first, then what is inside it, then everywhere else:
                the chips a thumb can reach are the ones about where you are.
                Pressed rather than linked, so the sheet stays where it is. */}
            {place ? (
              <Choice chosen={place.key === target?.key} onChoose={() => choose(place, false)}>
                {place.label}
              </Choice>
            ) : null}
            {narrower.map(one => (
              <Choice key={one.key} chosen={one.key === target?.key} onChoose={() => choose(one, true)}>
                {one.label}
              </Choice>
            ))}
            {places
              .filter(one => one.key !== place?.key)
              .map(one => (
                <Choice key={one.key} chosen={false} onChoose={() => choose(one, false)}>
                  {one.label}
                </Choice>
              ))}
          </div>

          <div className={styles.tiles}>
            {tiles.map(kind => {
              const Icon = ICONS[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  className={`${ui.card} ${styles.tile}`}
                  data-wide={kind === 'visit' || undefined}
                  disabled={!ready}
                  onPointerDown={() => {
                    held.current = false;
                    timer.current = window.setTimeout(() => {
                      held.current = true;
                      details(kind);
                    }, HOLD_MS);
                  }}
                  onPointerUp={stop}
                  onPointerLeave={stop}
                  onPointerCancel={stop}
                  onContextMenu={event => {
                    event.preventDefault();
                    stop();
                    details(kind);
                  }}
                  onClick={event => {
                    stop();
                    // The hold has already opened the details; the click that follows it is not a second instruction.
                    if (held.current) return void (held.current = false);
                    if (event.shiftKey) return details(kind);
                    tap(kind);
                  }}
                >
                  <Icon size={18} strokeWidth={1.75} className={styles.tileIcon} aria-hidden />
                  <span className={styles.tileName}>{t(`log.tile.${kind}`, { minutes: VISIT_MINUTES })}</span>
                  <span className={`mono ${styles.tileCaption}`}>{caption(kind)}</span>
                </button>
              );
            })}
          </div>

          <p className={ui.note}>{t(tiles.includes('visit') ? 'log.oneTapVisit' : 'log.oneTap')}</p>
        </>
      )}
    </Sheet>
  );
}

/** Whether this is a screen that is touched rather than pointed at, which decides how a tile's details are reached. */
const touch = (): boolean => typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches === true;

const lastAgo = (t: Translate, entry: { occurredAt: string } | null, now: DateTime): string =>
  entry ? t('log.lastAgo', { age: ageLabel(entry.occurredAt, now) }) : '';

/** "Schema-Wo 5 · Bio·Bloom": what the grid says for the week the grow is in, the week first so a narrow tile keeps it. */
const feedCaption = (t: Translate, grow: GrowListItem | undefined, now: DateTime): string => {
  const step = schemeStep(grow, now.toJSDate());
  const first = step?.amounts.find(amount => amount.value !== null);

  return step && first ? `${t('log.tile.schemeWeek', { week: step.week })} · ${first.name}` : '';
};

/** The measurements this grow takes, which is what the Measure tile would ask for. */
const measureCaption = (grow: GrowListItem | undefined): string =>
  (grow?.measurements ?? [])
    .slice(0, 2)
    .map(measurement => measurement.name)
    .join(' · ');
