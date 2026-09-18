import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceClaimResult, HomeAnswer } from '@fg2/shared-types/v1';
import { useHome } from '@/api/home';
import { ageLabel } from '@/ui/age';
import { useReportFreshness } from '@/ui/freshness';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { EmptyHome } from './EmptyHome';
import { isClub, sortedByAttention } from './home/attention';
import { SpaceCard } from './home/SpaceCard';
import { AttentionStrip, DueStrip, FollowingStrip } from './home/Strips';
import styles from './Home.module.css';

/**
 * Home is one card per space. It waits in its own shape, and once it has
 * answered it never goes blank again: a refresh that fails keeps the last
 * answer on the screen with its ages, which is what the ages are for.
 */
export function Home() {
  const { t } = useTranslation();
  const home = useHome();
  const [claimed, setClaimed] = useState<DeviceClaimResult | null>(null);

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
  if (claimed || (answer.spaces.length === 0 && answer.followedGrows.length === 0)) {
    return <EmptyHome claimed={claimed} onClaimed={setClaimed} />;
  }

  return <Cards answer={answer} failedAt={home.isError ? home.dataUpdatedAt : null} />;
}

function Cards({ answer, failedAt }: { answer: HomeAnswer; failedAt: number | null }) {
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
          <SpaceCard key={card.spaceId} card={card} people={answer.people} now={now} compact={club} />
        ))}
      </div>

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
