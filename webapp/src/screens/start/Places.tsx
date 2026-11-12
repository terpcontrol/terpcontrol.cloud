import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Device, HomeAnswer, HomeSpaceCard, Space } from '@fg2/shared-types/v1';
import { useDeviceLive, useDevices } from '@/api/devices';
import { useDiaryLayer } from '@/api/layers';
import { mediaUrl, THUMBNAIL_WIDTH, useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { placePath, type PlaceCard as Place } from '@/app/places';
import { ageAttribute } from '@/ui/age';
import { factsOf, unbroken } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';
import { RefreshFailed } from '@/ui/PageState';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { NotifyNotice } from '@/screens/notifications/NotifyNotice';
import { AddPlace } from './AddPlace';
import { livenessOf, sortedByAttention } from './attention';
import { useCardStatus } from './card-status';
import { toneOf } from './place';
import { readingFacts, readingsOf } from './readings';
import { groupedByRoom } from './rooms';
import { DemoBanner, GuestLine } from './states';
import { dueNow, useWaitingSteps, type Due } from './due';
import { Today } from './Today';
import styles from './Start.module.css';

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
  const zone = useZone();
  const { user } = useSession();
  const diary = useDiaryLayer();
  const devices = useDevices(places.some(place => place.deviceIds.length > 0)).data?.items;
  const spaces = useSpaces().data?.items ?? [];
  const groups = groupedByRoom(sortedByAttention(places), spaces);
  const demo = user?.isDemo === true;
  const spaceOf = (card: Place): Space | undefined => spaces.find(one => one.id === card.spaceId);
  // Somebody else's place says whose it is and what the reader may do there.
  const foreign = (card: Place): Space | null => {
    const space = spaceOf(card);
    return space && user && !demo && space.ownerId !== user.id ? space : null;
  };
  const due: Due[] = [...places, ...loose].flatMap(card =>
    card.dueTasks.map(task => ({
      task,
      spaceId: card.spaceId,
      place: card.name,
      grow: card.grow ? { growId: card.grow.growId, name: card.grow.name } : null,
    })),
  );
  const named = places.map(place => ({ spaceId: place.spaceId, name: place.name, growIds: place.grow ? [place.grow.growId] : [] }));
  // What a card says is due is what "Heute" lists for it: the diary's reminders, and a plan step waiting for its word.
  const reminders = demo || !diary ? [] : dueNow(due, now, zone);
  const steps = useWaitingSteps(demo ? [] : named, now);
  const dueIn = (spaceId: string): number =>
    reminders.filter(one => one.spaceId === spaceId).length + steps.filter(step => step.place.spaceId === spaceId).length;
  const card = (one: Place) => <PlaceCard key={one.spaceId} card={one} devices={devices} now={now} diary={diary} due={dueIn(one.spaceId)} />;

  return (
    <section className={styles.page}>
      {demo ? <DemoBanner /> : null}
      <div className={styles.head}>
        <h1>{t('shell.tabs.home')}</h1>
      </div>
      <RefreshFailed failedAt={failedAt} now={now} />

      <div className={styles.columns}>
        <div className={`${styles.column} ${styles.places}`}>
          {groups.map((group, index) => {
            const guest = foreign(group.cards[0]);
            if (group.room || guest) {
              return (
                <section key={group.room?.id ?? group.cards[0].spaceId} className={styles.room} aria-label={group.room?.name ?? group.cards[0].name}>
                  {guest ? (
                    <GuestLine space={guest} people={answer.people} room={group.room?.name} />
                  ) : (
                    <h2 className={styles.kicker}>{group.room?.name}</h2>
                  )}
                  {group.cards.map(card)}
                </section>
              );
            }
            // A place in no room that follows a room's cards would read as one more of them, so it is said to stand in none.
            const afterRoom = index > 0 && groups[index - 1].room !== null;
            return afterRoom ? (
              <section key={group.cards[0].spaceId} className={styles.room} aria-label={t('start.noRoom')}>
                <h2 className={styles.kicker}>{t('start.noRoom')}</h2>
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

        <div className={styles.column}>
          {/* It says itself whether anything here can call on the account - a device, a camera, a reminder. */}
          <NotifyNotice later />
          {demo ? null : <Today due={diary ? due : []} places={named} across now={now} />}
          {demo ? null : <AddPlace wide />}
        </div>
      </div>
    </section>
  );
}

const PILL: Partial<Record<ReturnType<typeof toneOf>, string>> = { good: 'start.card.good', warn: 'start.card.check', alarm: 'start.card.check' };

/**
 * One place among several: its name and whether it wants looking at, the
 * status sentence of its own Start where it does, what it reads in one line,
 * and what grows there - beside the camera's newest picture where there is
 * one. It says what the place's Start says, from the same arithmetic.
 */
function PlaceCard({ card, devices, now, diary, due }: { card: Place; devices: Device[] | undefined; now: DateTime; diary: boolean; due: number }) {
  const { t } = useTranslation();
  const zone = useZone();
  const { here, device, values, status, said } = useCardStatus(card, devices, now);
  const live = useDeviceLive(device?.id ?? null).data;
  const lamp = here.find(one => one.type === 'light' && one.id !== device?.id) ?? null;
  const lampLive = useDeviceLive(lamp?.id ?? null).data;
  const lit =
    device && live?.outputs.light?.value != null
      ? { device, live }
      : lamp && lampLive?.outputs.light?.value != null
        ? { device: lamp, live: lampLive }
        : null;
  const tone = toneOf(status);
  const asks = tone === 'warn' || tone === 'alarm';
  const offline = status.kind === 'offline';
  const setpoints = card.climates[0]?.setpoints ?? card.setpoints;
  const readings = readingsOf(t, { values, setpoints, device, lit: offline ? null : lit, hold: null, now, zone });
  const figures = readingFacts(t, readings);
  const pill = offline ? 'home.reading.offline' : PILL[tone];
  const still = card.latestStill ? mediaUrl(card.latestStill.mediaId, THUMBNAIL_WIDTH.still) : null;
  const grow =
    diary && card.grow
      ? [
          card.grow.name,
          card.grow.dayNumber !== null ? t('home.card.dayN', { day: card.grow.dayNumber }) : null,
          card.grow.stage ? t(`home.stage.${card.grow.stage}`) : null,
        ]
      : [];

  return (
    <Link to={placePath(card.spaceId)} className={styles.place} data-asks={asks || undefined}>
      {still ? <img className={styles.still} src={still} alt={t('home.card.stillAlt', { name: card.name })} loading="lazy" /> : null}
      <span className={styles.placeText}>
        <span className={styles.placeHead}>
          <span className={styles.placeName}>{card.name}</span>
          {pill ? (
            <span className={styles.pill} data-tone={tone}>
              {t(pill)}
            </span>
          ) : null}
        </span>
        {status.kind === 'good' || status.kind === 'none' ? null : (
          <span className={styles.placeStatus} data-tone={tone}>
            <Facts facts={factsOf(said).map(unbroken)} />
          </span>
        )}
        {figures.length > 0 ? (
          <span className={styles.placeFigures} {...ageAttribute(livenessOf(card, now) === 'offline' ? 'offline' : 'live')}>
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
        <Facts
          className={styles.placeGrow}
          facts={[
            t('grow.noFixedPlace'),
            grow.dayNumber !== null ? t('home.card.dayN', { day: grow.dayNumber }) : null,
            grow.stage ? t(`home.stage.${grow.stage}`) : null,
          ]}
        />
      </span>
    </Link>
  );
}
