import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Device, HomeAnswer, HomeSpaceCard, Space } from '@fg2/shared-types/v1';
import { useDevices } from '@/api/devices';
import { useGrows } from '@/api/grows';
import { useDiaryLayer } from '@/api/layers';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { placePath, type PlaceCard as Place } from '@/app/places';
import { ageAttribute, livenessWords, sinceLabel, valueAge } from '@/ui/age';
import { factsOf, unbroken } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';
import { RefreshFailed } from '@/ui/PageState';
import { useNow } from '@/ui/useNow';
import { figure, figureWithUnit, UNIT } from '@/ui/units';
import { clock, useZone } from '@/ui/zone';
import type { Translate } from '@/i18n/i18n';
import { NotifyNotice } from '@/screens/notifications/NotifyNotice';
import { AddPlace } from './AddPlace';
import { judgedAt, livenessOf } from './attention';
import { useCardStatus } from './card-status';
import { Figures, type Figure } from './Figures';
import { toneOf, valueOf, type Status } from './place';
import { readingsOf } from './readings';
import { useLamp } from './reads';
import { startOrder } from './rooms';
import { growDay } from '@/screens/grow/progress';
import { alsoIn } from '@/screens/space/movable-grows';
import { namesInLeadOrder, targetsOf } from '@/log/targets';
import { usePlaceGrow } from '@/log/underneath';
import { DemoBanner, GuestLine } from './states';
import { duePlaces, useDue } from './due';
import { Today } from './Today';
import styles from './Start.module.css';
import ui from '@/ui/ui.module.css';

/**
 * Start with several places: one card per place under the room it stands in,
 * the one that needs a person first, then what is due today across all of
 * them. A card opens that place's Start, which makes it the chosen place, and
 * says itself when something is due there - on a phone "Heute" stands under
 * the cards, and nobody should have to scroll to learn that a tent wants
 * watering. Where the rail stands beside the page, the cards of a room pair up
 * and "Heute" follows them as on a phone. A grow standing in no place is a
 * card too, and opens at the grow.
 */
export function Places({
  places,
  loose,
  answer,
  failedAt,
}: {
  places: Place[];
  loose: HomeSpaceCard[];
  answer: HomeAnswer;
  failedAt: number | null;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const { user } = useSession();
  const diary = useDiaryLayer();
  const devices = useDevices(places.some(place => place.deviceIds.length > 0)).data?.items;
  const spaces = useSpaces().data?.items ?? [];
  const demo = user?.isDemo === true;
  const spaceOf = (card: Place): Space | undefined => spaces.find(one => one.id === card.spaceId);
  // Somebody else's place says whose it is and what the reader may do there.
  const foreign = (card: Place): Space | null => {
    const space = spaceOf(card);
    return space && user && !demo && space.ownerId !== user.id ? space : null;
  };
  // What a card says is due is what "Heute" lists for it, and what moves it up.
  const due = useDue(now).rows;
  const groups = startOrder(places, spaces, duePlaces(due));
  const dueIn = (spaceId: string): number => due.filter(one => one.spaceId === spaceId).length;
  // A refresh that fails ages the page, not the devices: each place is judged as the last answer left it.
  const judged = judgedAt(now, failedAt);
  const card = (one: Place) => (
    <PlaceCard key={one.spaceId} card={one} devices={devices} now={now} judged={judged} diary={diary} due={dueIn(one.spaceId)} />
  );

  // Places in no room stand together; the first of them after a room's cards says it stands in none, or it would read as
  // one more of that room's. A room, and a place somebody else shares, is a section of its own.
  const runs = groups.reduce<Run[]>((all, group, index) => {
    const guest = foreign(group.cards[0]);
    const last = all.at(-1);
    if (!group.room && !guest && last && !last.room && !last.guest) {
      last.cards.push(...group.cards);
      return all;
    }
    const afterRoom = index > 0 && groups[index - 1].room !== null;
    return [
      ...all,
      { key: group.room?.id ?? group.cards[0].spaceId, room: group.room?.name ?? null, guest, apart: afterRoom, cards: [...group.cards] },
    ];
  }, []);

  return (
    <section className={`${ui.stack3} ${styles.page} ${styles.list}`}>
      {demo ? <DemoBanner /> : null}
      <div className={styles.head}>
        <h1>{t('shell.tabs.home')}</h1>
      </div>
      <RefreshFailed failedAt={failedAt} now={now} />

      {runs.map(run => {
        const cards = (
          <div key={run.key} className={styles.cards}>
            {run.cards.map(card)}
          </div>
        );
        if (!run.room && !run.guest && !run.apart) return cards;
        const named = run.room ?? (run.guest ? run.cards[0].name : t('start.noRoom'));
        return (
          <section key={run.key} className={`${ui.stack3} ${styles.room}`} aria-label={named}>
            {run.guest ? <GuestLine space={run.guest} people={answer.people} room={run.room} /> : <h2 className={ui.cardHeading}>{named}</h2>}
            {cards}
          </section>
        );
      })}
      {loose.length > 0 ? (
        <div className={styles.cards}>
          {loose.map(one => (
            <LooseGrowCard key={one.grow?.growId} card={one} />
          ))}
        </div>
      ) : null}

      <div className={styles.cards}>
        {/* It says itself whether anything here can call on the account - a device, a camera, a reminder. */}
        <NotifyNotice later />
        <Today now={now} />
      </div>
      {/* Under the cards on a phone, in the title's row where the rail stands beside the page. */}
      {demo ? null : (
        <div className={styles.addPlace}>
          <AddPlace wide />
        </div>
      )}
    </section>
  );
}

/** A run of cards under one heading, or under none. `apart` is a run of places in no room that follows a room's. */
interface Run {
  key: string;
  room: string | null;
  guest: Space | null;
  apart: boolean;
  cards: Place[];
}

/**
 * The pill beside a card's name: the place's state in the words a device's
 * pill and Steuerung say it with - "im Ziel", "Alarm", "veraltet", "Wartung",
 * "Regelung aus" -, never a bare "prüfen" that names nothing. A place that is
 * waiting, has no targets or nothing to judge carries none.
 */
const pillOf = (t: Translate, status: Status): string | null => {
  switch (status.kind) {
    case 'good':
      return t('start.card.good');
    case 'off':
      return t('start.card.off');
    case 'alert':
      return t('start.card.alarm');
    case 'offline':
    case 'stale':
      return t(`home.reading.${status.kind}`);
    // Once the window is over and only the alarms rest, the sentence says so, and a pill saying "Wartung" beside it
    // would contradict it.
    case 'maintenance':
      return status.quiet.parked ? t('maintenance.title') : null;
    case 'controlOff':
      return t('control.state.off');
    case 'mode':
      return t(`home.stage.${status.mode}`);
    default:
      return null;
  }
};

/**
 * One place among several, as master's Home card drew it: its name and
 * whether it wants looking at, the readings as big figures with their names -
 * temperature, humidity, and VPD and CO₂ where the place measures them -, the
 * status sentence of its own Start where it asks for somebody, the lamps in one
 * line, and what grows there. A card that asks for somebody has an edge in the
 * colour of what it asks; the pill says the device's state in its own colour,
 * so "offline" is the grey it is on the place's page, and the edge and the
 * sentence take the worst alert open there. It says what the place's Start
 * says, from the same arithmetic.
 */
function PlaceCard({
  card,
  devices,
  now,
  judged,
  diary,
  due,
}: {
  card: Place;
  devices: Device[] | undefined;
  now: DateTime;
  /** The instant the place's state is judged at, which is the last answer's while a refresh fails. */
  judged: DateTime;
  diary: boolean;
  due: number;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const { here, device, values, setpoints, status, words, behind } = useCardStatus(card, devices, judged);
  const { lit } = useLamp(device, here, now);
  const tone = toneOf(status);
  const asks = tone === 'warn' || tone === 'alarm';
  const offline = status.kind === 'offline';
  const readings = readingsOf(t, { values, setpoints, device, lit: offline ? [] : lit, hold: null, now, zone });
  const co2 = valueOf(values, 'co2');
  const figures: Figure[] = [
    ...readings.filter(reading => reading.key !== 'light'),
    ...(co2
      ? [
          {
            key: 'co2' as const,
            label: t('home.metric.co2'),
            figure: figureWithUnit(co2.value!, 'co2'),
            number: figure(co2.value!, 'co2'),
            unit: UNIT.co2 ?? null,
            tone: 'quiet' as const,
            age: valueAge(co2, now),
          },
        ]
      : []),
  ];
  const lamps = readings.flatMap(reading => (reading.key === 'light' ? [reading.said ?? reading.figure] : []));
  const pill = pillOf(t, status);
  // The pill says "offline", "veraltet" or "Wartung"; the line beside it says since or until when, or how old the
  // values are, and not the word a second time.
  const said =
    status.kind === 'offline'
      ? status.since
        ? t('start.status.since', { time: sinceLabel(status.since, judged, zone) })
        : null
      : status.kind === 'stale'
        ? livenessWords('stale', status.at, judged)[1]
        : status.kind === 'maintenance' && status.quiet.parked
          ? t('start.status.maintenanceUntil', { until: clock(status.quiet.until, zone) })
          : words;
  // A place that holds two grows names both, in the order every page leads with them: the card's answer carries the
  // newer one alone.
  const grows = useGrows(diary && card.grow !== null).data?.items;
  const others = alsoIn(grows, card.spaceId, card.grow?.growId);
  const lead = usePlaceGrow(others.length > 0 ? card.spaceId : null);
  const grow =
    diary && card.grow
      ? others.length > 0
        ? [namesInLeadOrder(targetsOf({ spaces: [card] }, grows), card.spaceId, lead).join(', ')]
        : [
            <span key="name" className={styles.placeGrowName}>
              {unbroken(card.grow.name)}
            </span>,
            growDay(t, card.grow),
            card.grow.stage ? t(`home.stage.${card.grow.stage}`) : null,
          ]
      : [];

  return (
    <Link to={placePath(card.spaceId)} className={styles.place} data-asks={asks ? tone : undefined}>
      <span className={styles.placeHead}>
        <span className={styles.placeName}>{card.name}</span>
        {pill ? (
          <span className={styles.pill} data-tone={offline ? 'quiet' : tone}>
            {pill}
          </span>
        ) : null}
      </span>
      {figures.length > 0 ? (
        <span className={styles.placeFigures} {...ageAttribute(livenessOf(card, judged) === 'offline' ? 'offline' : 'live')}>
          <Figures figures={figures} />
        </span>
      ) : null}
      {/* What stands open is red where one of it is critical, as on the place's page. */}
      {status.kind === 'good' || status.kind === 'none' ? null : (
        <span className={styles.placeStatus} data-tone={tone}>
          <Facts
            facts={[
              ...factsOf(said ?? '').map(unbroken),
              behind ? (
                <span
                  key="open"
                  className={styles.open}
                  data-tone={'critical' in status && status.critical > 0 && status.kind !== 'alert' ? 'alarm' : undefined}
                >
                  {unbroken(behind)}
                </span>
              ) : null,
            ]}
          />
        </span>
      )}
      {lamps.length > 0 ? <Facts className={styles.placeLine} facts={lamps} /> : null}
      {grow.length > 0 ? <Facts className={styles.placeGrow} facts={grow} /> : null}
      {due > 0 ? <span className={styles.placeDue}>{t('start.card.due', { count: due })}</span> : null}
    </Link>
  );
}

/** A grow that stands in no place at all, which has no Start of its own and opens at the grow. */
function LooseGrowCard({ card }: { card: HomeSpaceCard }) {
  const { t } = useTranslation();
  const grow = card.grow;
  if (!grow) return null;

  return (
    <Link to={`/grows/${grow.growId}`} className={styles.place}>
      <span className={styles.placeName}>{grow.name}</span>
      <Facts className={styles.placeGrow} facts={[t('grow.noFixedPlace'), growDay(t, grow), grow.stage ? t(`home.stage.${grow.stage}`) : null]} />
    </Link>
  );
}
