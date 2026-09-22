import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HomeAnswer } from '@fg2/shared-types/v1';
import { useHome } from '@/api/home';
import { ageLabel } from '@/ui/age';
import { useReportFreshness } from '@/ui/freshness';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { EmptyHome } from './EmptyHome';
import { NewGrowRow } from './grow/new/NewGrowRow';
import { NewGrowSheet } from './grow/new/NewGrowSheet';
import { isClub, sortedByAttention } from './home/attention';
import { SpaceCard } from './home/SpaceCard';
import { AttentionStrip, DueStrip, FollowingStrip } from './home/Strips';
import styles from './Home.module.css';

/**
 * Home is one card per space, plus one for each open grow that stands in no
 * space at all - "no fixed place" is a card and not a hole. It waits in its own
 * shape, and once it has answered it never goes blank again: a refresh that
 * fails keeps the last answer on the screen with its ages, which is what the
 * ages are for.
 */
export function Home() {
  const { t } = useTranslation();
  const home = useHome();
  // The sheet is held here rather than in either half of the home, because the
  // first thing it writes - a grow, or the place to stand it in - is what
  // decides which half is drawn, and a sheet inside that half would close on
  // its own first answer.
  const [starting, setStarting] = useState(false);

  useReportFreshness(home.dataUpdatedAt ? new Date(home.dataUpdatedAt).toISOString() : null);

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
  // Owning nothing is what makes the home empty. Following somebody is not
  // owning something, so a grower who follows a friend while their hardware is
  // in the post keeps the two doors and the claim-code field, with the strip
  // under them where a strip belongs.
  const nothingYet = answer.spaces.length === 0;

  return (
    <>
      {nothingYet ? (
        <Nothing grows={answer.followedGrows} onStartGrow={() => setStarting(true)} />
      ) : (
        <Cards answer={answer} failedAt={home.isError ? home.dataUpdatedAt : null} onStartGrow={() => setStarting(true)} />
      )}
      {starting ? <NewGrowSheet onClose={() => setStarting(false)} /> : null}
    </>
  );
}

/** The empty home, and under it whatever is being followed from it. */
function Nothing({ grows, onStartGrow }: { grows: HomeAnswer['followedGrows']; onStartGrow: () => void }) {
  const now = useNow();

  return (
    <>
      <EmptyHome onStartGrow={onStartGrow} />
      <FollowingStrip grows={grows} now={now} />
    </>
  );
}

function Cards({ answer, failedAt, onStartGrow }: { answer: HomeAnswer; failedAt: number | null; onStartGrow: () => void }) {
  const { t } = useTranslation();
  const now = useNow();
  const club = isClub(answer.spaces);
  const cards = sortedByAttention(answer.spaces);

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t('shell.tabs.home')}</h1>
        <span className={`mono ${styles.caption}`}>
          {t('home.count', { count: cards.length })} · {t('home.sortedByAttention')}
        </span>
      </header>

      {failedAt ? (
        <p className={`mono ${styles.failed}`} role="status">
          {t('home.refreshFailed', { age: ageLabel(new Date(failedAt).toISOString(), now) })}
        </p>
      ) : null}

      <AttentionStrip cards={cards} now={now} />
      <DueStrip cards={cards} now={now} />

      <div className={styles.cards}>
        {cards.map(card => (
          // A card with no place is known by its grow, which is the only id it has.
          <SpaceCard key={card.spaceId ?? card.grow?.growId} card={card} people={answer.people} now={now} compact={club} />
        ))}
      </div>

      <NewGrowRow onOpen={onStartGrow} />

      <FollowingStrip grows={answer.followedGrows} now={now} />
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
