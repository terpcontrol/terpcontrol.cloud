import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HomeAnswer, HomeSpaceCard } from '@fg2/shared-types/v1';
import { isPlace, type PlaceCard as Place } from '@/app/places';
import { useMe } from '@/api/account';
import { fetchedAt } from '@/api/clock';
import { useDevices } from '@/api/devices';
import { useMyGrows } from '@/api/grows';
import { useHome } from '@/api/home';
import { useDiaryLayer } from '@/api/layers';
import { useSession } from '@/api/session';
import { ageLabel } from '@/ui/age';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { EmptyHome } from './EmptyHome';
import { NotifyNotice } from './notifications/NotifyNotice';
import { MyGrowsLine } from './grow/MyGrows';
import { NewGrowRow } from './grow/new/NewGrowRow';
import { NewGrowSheet } from './grow/new/NewGrowSheet';
import { LooseGrowCard, PlaceCard } from './cockpit/PlaceCard';
import { PlaceCockpitRead } from './cockpit/PlaceCockpit';
import { sortedByAttention } from './home/attention';
import { DiaryOffer } from './home/DiaryOffer';
import { DueStrip, FollowingStrip } from './home/Strips';
import styles from './Home.module.css';

/**
 * Start. With one place it is that place's cockpit, the same page the place
 * opens at its own address; with several it is one compact card per place,
 * each opening that cockpit. A grow standing in no place is a card of its own
 * under either, because there is no place page for it to be part of. For
 * whoever keeps a diary, every grow at once, finished ones included, is a tap
 * away: from the cockpit's grow block with one place, from a line under the
 * cards with several, and from the top of an empty Start whose grows have all
 * ended.
 *
 * It waits in its own shape, and once it has answered it never goes blank
 * again: a refresh that fails keeps the last answer with its ages.
 */
export function Home() {
  const { t } = useTranslation();
  const home = useHome();
  // The sheet is held here rather than in the list, because the first thing it
  // writes - a grow, or the place to stand it in - can change which Start is
  // drawn, and a sheet inside the half that goes would close on its own answer.
  const [starting, setStarting] = useState(false);

  if (home.isPending) return <Waiting />;
  if (home.isError && !home.data) {
    return (
      <section className={styles.page}>
        <p className={ui.problem} role="alert">
          {t('shell.loadFailed')}
        </p>
        <button type="button" className={ui.button} onClick={() => void home.refetch()}>
          {t('home.retry')}
        </button>
      </section>
    );
  }

  const answer = home.data!;
  const places = answer.spaces.filter(isPlace);
  const loose = answer.spaces.filter(card => !isPlace(card));

  return (
    <>
      {answer.spaces.length === 0 ? (
        <Nothing grows={answer.followedGrows} onStartGrow={() => setStarting(true)} />
      ) : places.length === 1 ? (
        <OnePlace place={places[0]} loose={loose} answer={answer} />
      ) : (
        <Places
          places={places}
          loose={loose}
          answer={answer}
          failedAt={home.isError ? home.dataUpdatedAt : null}
          onStartGrow={() => setStarting(true)}
        />
      )}
      {starting ? <NewGrowSheet onClose={() => setStarting(false)} /> : null}
    </>
  );
}

/**
 * The empty home, and under it whatever is being followed from it.
 *
 * An account whose grows have all ended owns no running grow and may own no
 * place, and lands here too: it is told that nothing runs right now rather
 * than that nothing is here, and the way to its grows stands at the top
 * rather than under three offers made to somebody new.
 */
function Nothing({ grows, onStartGrow }: { grows: HomeAnswer['followedGrows']; onStartGrow: () => void }) {
  const now = useNow();
  const diary = useDiaryLayer();
  const mine = useMyGrows(diary);
  const past = diary && (mine.data?.items.length ?? 0) > 0;

  return (
    <>
      <EmptyHome onStartGrow={onStartGrow} past={past ? <MyGrowsLine /> : null} />
      <FollowingStrip grows={grows} now={now} />
    </>
  );
}

/**
 * One place: its cockpit is Start, and the grows without a place stand under
 * it. The way to every grow is the cockpit's grow block, beside its tasks,
 * rather than a line under the last of the cockpit's sections.
 */
function OnePlace({ place, loose, answer }: { place: Place; loose: HomeSpaceCard[]; answer: HomeAnswer }) {
  const now = useNow();

  return (
    <div className={styles.one}>
      <PlaceCockpitRead spaceId={place.spaceId} />
      {loose.length > 0 ? (
        <div className={styles.cards}>
          {loose.map(card => (
            <LooseGrowCard key={card.grow?.growId} card={card} />
          ))}
        </div>
      ) : null}
      <FollowingStrip grows={answer.followedGrows} now={now} />
    </div>
  );
}

function Places({
  places,
  loose,
  answer,
  failedAt,
  onStartGrow,
}: {
  places: Place[];
  loose: HomeSpaceCard[];
  answer: HomeAnswer;
  failedAt: number | null;
  onStartGrow: () => void;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const { user } = useSession();
  const me = useMe(false, user !== null && user.isDemo !== true);
  const devices = useDevices(places.some(place => place.deviceIds.length > 0));
  const cards = sortedByAttention(places);
  const diary = useDiaryLayer();
  // Offered once the account has been read and only where nobody said no; the demo has no account to keep an answer with.
  const offerDiary = !diary && me.data !== undefined && me.data.preferences.diary !== 'off';

  return (
    <section className={styles.page}>
      {/* Start says what it is with its cards, on a desktop as on a phone and
          as the cockpit of a single place does: the title it had - "Start · 2
          Orte · nach Dringlichkeit" - was the old Start's and stands only for
          whoever hears the page rather than sees it. */}
      <h1 className={styles.hiddenTitle}>{t('shell.tabs.home')}</h1>

      {failedAt ? (
        <p className={`mono ${styles.failed}`} role="status">
          {t('home.refreshFailed', { age: ageLabel(fetchedAt(failedAt), now) })}
        </p>
      ) : null}

      {/* It says itself whether anything here can call on the account - a device, a camera, a reminder. */}
      <NotifyNotice later />
      {diary ? <DueStrip cards={cards} now={now} /> : null}

      <div className={styles.cards}>
        {cards.map(card => (
          <PlaceCard key={card.spaceId} card={card} devices={devices.data?.items} now={now} diary={diary} />
        ))}
        {loose.map(card => (
          <LooseGrowCard key={card.grow?.growId} card={card} />
        ))}
      </div>

      {diary ? <NewGrowRow onOpen={onStartGrow} /> : null}
      {diary ? <MyGrowsLine /> : null}
      <FollowingStrip grows={answer.followedGrows} now={now} />
      {offerDiary ? <DiaryOffer /> : null}
    </section>
  );
}

/** Two cards' worth of the shape a card has, saying what they are waiting for. */
function Waiting() {
  const { t } = useTranslation();

  return (
    <section className={styles.page} aria-busy="true">
      <div className={styles.cards}>
        {[0, 1].map(index => (
          <div key={index} className={`${ui.card} ${styles.waiting}`}>
            <div className={styles.waitingHeader}>
              <span className={styles.waitingName} />
              <span className={`mono ${styles.waitingNote}`}>{t('home.waiting')}</span>
            </div>
            <div className={styles.waitingFigures}>
              <span className={styles.waitingFigure} />
              <span className={styles.waitingFigure} />
              <span className={styles.waitingFigure} />
            </div>
            <span className={styles.waitingLine} />
          </div>
        ))}
      </div>
    </section>
  );
}
