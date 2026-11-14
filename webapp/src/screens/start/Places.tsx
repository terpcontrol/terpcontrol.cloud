import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Device, HomeAnswer, HomeSpaceCard, Space } from '@fg2/shared-types/v1';
import { useDevices } from '@/api/devices';
import { useGrows } from '@/api/grows';
import { useDiaryLayer } from '@/api/layers';
import { mediaUrl, THUMBNAIL_WIDTH, useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { placePath, type PlaceCard as Place } from '@/app/places';
import { ageAttribute, sinceLabel } from '@/ui/age';
import { factsOf, unbroken } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';
import { RefreshFailed } from '@/ui/PageState';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import type { Translate } from '@/i18n/i18n';
import { NotifyNotice } from '@/screens/notifications/NotifyNotice';
import { AddPlace } from './AddPlace';
import { judgedAt, livenessOf } from './attention';
import { useCardStatus } from './card-status';
import { toneOf, type Status } from './place';
import { readingFacts, readingsOf } from './readings';
import { useLamp } from './reads';
import { startOrder } from './rooms';
import { growDay } from '@/screens/grow/progress';
import { alsoIn } from '@/screens/space/movable-grows';
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
 * watering. Where two columns fit, the cards stand left and "Heute" right. A
 * grow standing in no place is a card too, and opens at the grow.
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

  return (
    <section className={`${ui.stack3} ${styles.page}`}>
      {demo ? <DemoBanner /> : null}
      <div className={styles.head}>
        <h1>{t('shell.tabs.home')}</h1>
      </div>
      <RefreshFailed failedAt={failedAt} now={now} />

      <div className={`${ui.stack3} ${styles.columns}`}>
        <div className={`${ui.stack3} ${styles.column} ${styles.places}`}>
          {groups.map((group, index) => {
            const guest = foreign(group.cards[0]);
            if (group.room || guest) {
              return (
                <section
                  key={group.room?.id ?? group.cards[0].spaceId}
                  className={`${ui.stack3} ${styles.room}`}
                  aria-label={group.room?.name ?? group.cards[0].name}
                >
                  {guest ? (
                    <GuestLine space={guest} people={answer.people} room={group.room?.name} />
                  ) : (
                    <h2 className={ui.cardHeading}>{group.room?.name}</h2>
                  )}
                  {group.cards.map(card)}
                </section>
              );
            }
            // A place in no room that follows a room's cards would read as one more of them, so it is said to stand in none.
            const afterRoom = index > 0 && groups[index - 1].room !== null;
            return afterRoom ? (
              <section key={group.cards[0].spaceId} className={`${ui.stack3} ${styles.room}`} aria-label={t('start.noRoom')}>
                <h2 className={ui.cardHeading}>{t('start.noRoom')}</h2>
                {card(group.cards[0])}
              </section>
            ) : (
              card(group.cards[0])
            );
          })}
          {loose.map(one => (
            <LooseGrowCard key={one.grow?.growId} card={one} />
          ))}
        </div>

        <div className={`${ui.stack3} ${styles.column}`}>
          {/* It says itself whether anything here can call on the account - a device, a camera, a reminder. */}
          <NotifyNotice later />
          <Today now={now} />
          {demo ? null : <AddPlace wide />}
        </div>
      </div>
    </section>
  );
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
 * One place among several: its name and whether it wants looking at, the
 * status sentence of its own Start where it does, what it reads in one line,
 * and what grows there - beside the camera's newest picture where there is
 * one. It says what the place's Start says, from the same arithmetic.
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
  const { lit, held } = useLamp(device, here, now);
  const tone = toneOf(status);
  const asks = tone === 'warn' || tone === 'alarm';
  const offline = status.kind === 'offline';
  const readings = readingsOf(t, { values, setpoints, device, lit: offline ? null : lit, held, hold: null, now, zone });
  const figures = readingFacts(t, readings);
  const pill = pillOf(t, status);
  // The pill says "offline"; the line beside it says since when, and not the word a second time.
  const said = status.kind === 'offline' ? (status.since ? t('start.status.since', { time: sinceLabel(status.since, judged, zone) }) : null) : words;
  const still = card.latestStill ? mediaUrl(card.latestStill.mediaId, THUMBNAIL_WIDTH.still) : null;
  // A place that holds two grows names both: the card's answer carries the newer one alone.
  const others = alsoIn(useGrows(diary && card.grow !== null).data?.items, card.spaceId, card.grow?.growId);
  const grow =
    diary && card.grow
      ? others.length > 0
        ? [[card.grow.name, ...others.map(one => one.name)].join(', ')]
        : [card.grow.name, growDay(t, card.grow), card.grow.stage ? t(`home.stage.${card.grow.stage}`) : null]
      : [];

  return (
    <Link to={placePath(card.spaceId)} className={styles.place} data-asks={asks || undefined}>
      {still ? <img className={styles.still} src={still} alt={t('home.card.stillAlt', { name: card.name })} loading="lazy" /> : null}
      <span className={styles.placeText}>
        <span className={styles.placeHead}>
          <span className={styles.placeName}>{card.name}</span>
          {pill ? (
            <span className={styles.pill} data-tone={tone}>
              {pill}
            </span>
          ) : null}
        </span>
        {/* A late device is said by the pill alone; what stands open is red where one of it is critical, as on the place's page. */}
        {status.kind === 'good' || status.kind === 'none' || status.kind === 'stale' ? null : (
          <span className={styles.placeStatus} data-tone={tone}>
            <Facts
              facts={[
                ...factsOf(said ?? '').map(unbroken),
                behind ? (
                  <span
                    key="open"
                    className={styles.open}
                    data-tone={'critical' in status && status.critical && status.kind !== 'alert' ? 'alarm' : undefined}
                  >
                    {unbroken(behind)}
                  </span>
                ) : null,
              ]}
            />
          </span>
        )}
        {figures.length > 0 ? (
          <span className={styles.placeFigures} {...ageAttribute(livenessOf(card, judged) === 'offline' ? 'offline' : 'live')}>
            <Facts facts={figures} />
          </span>
        ) : null}
        {grow.length > 0 ? <Facts className={styles.placeGrow} facts={grow} /> : null}
        {due > 0 ? <span className={styles.placeDue}>{t('start.card.due', { count: due })}</span> : null}
      </span>
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
      <span className={styles.placeText}>
        <span className={styles.placeName}>{grow.name}</span>
        <Facts className={styles.placeGrow} facts={[t('grow.noFixedPlace'), growDay(t, grow), grow.stage ? t(`home.stage.${grow.stage}`) : null]} />
      </span>
    </Link>
  );
}
