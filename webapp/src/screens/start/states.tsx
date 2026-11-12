import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { Person, Space } from '@fg2/shared-types/v1';
import { session, useSession } from '@/api/session';
import { sinceLabel } from '@/ui/age';
import { useNow } from '@/ui/useNow';
import { nowThere, useZone, zoned } from '@/ui/zone';
import { lastLoaded } from './loaded';
import styles from './Start.module.css';

/** Start while it waits for its first answer: the shape of a place, grey, saying it is loading to whoever cannot see that. */
export function StartWaiting() {
  const { t } = useTranslation();
  const card = (
    <div className={styles.card}>
      <span className={styles.wait} style={{ width: 60, height: 14 }} />
      <span className={styles.wait} style={{ width: '70%', height: 16 }} />
      <span className={styles.wait} style={{ width: '50%', height: 16 }} />
    </div>
  );

  return (
    <section className={styles.page} aria-busy="true" aria-label={t('start.waiting')}>
      <div className={styles.head}>
        <span className={styles.wait} style={{ width: 96, height: 26 }} />
      </div>
      <div className={styles.columns}>
        <div className={styles.column}>
          <span className={`${styles.wait} ${styles.waitPicture}`} />
          <span className={styles.wait} style={{ width: 150, height: 18 }} />
          <span className={styles.wait} style={{ height: 6 }} />
        </div>
        <div className={styles.column}>
          {card}
          {card}
        </div>
      </div>
    </section>
  );
}

/**
 * Start that could not be read at all: what that means for the tent - nothing,
 * the devices regulate on - the way to try again, and when this browser last
 * had an answer.
 */
export function StartFailed({ retry }: { retry: () => void }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const { user } = useSession();
  const loaded = lastLoaded(user?.id ?? null);

  return (
    <section className={styles.page} data-single>
      <div className={styles.head}>
        <h1>{t('shell.tabs.home')}</h1>
      </div>
      <section className={styles.box} role="alert">
        <h2>{t('start.failed.title')}</h2>
        <p>{t('start.failed.text')}</p>
        <button type="button" className={styles.boxAction} onClick={retry}>
          {t('start.failed.retry')}
        </button>
      </section>
      {loaded ? (
        <p className={styles.loadedAt}>
          {t(zoned(loaded, zone).hasSame(nowThere(now, zone), 'day') ? 'start.failed.loadedToday' : 'start.failed.loadedOn', {
            time: sinceLabel(loaded, now, zone),
          })}
        </p>
      ) : null}
    </section>
  );
}

/** The demo says what it is on Start, with the way to an account of one's own: the demo's session ends, and sign-up opens. */
export function DemoBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);

  const leave = async () => {
    setLeaving(true);
    await session.logOut();
    await navigate('/sign-up', { replace: true });
  };

  return (
    <div className={styles.demo}>
      <span>{t('start.demo.says')}</span>
      <button type="button" className={styles.demoAction} disabled={leaving} onClick={() => void leave()}>
        {t('start.demo.signUp')}
      </button>
    </div>
  );
}

/**
 * Whose place this is and what the reader may do in it, for somebody let into
 * it: "Keller · von @handle" and "du darfst eintragen". The owner is named
 * where the answer names them; the room where the reader can see it.
 */
export function GuestLine({ space, people, room = null }: { space: Space; people: Person[]; room?: string | null }) {
  const { t } = useTranslation();
  const handle = people.find(person => person.id === space.ownerId)?.handle ?? null;
  const from = handle ? t('start.guest.by', { handle }) : t('start.guest.shared');

  return (
    <div className={styles.guest}>
      <h2 className={styles.kicker}>{[room, from].filter(Boolean).join(' · ')}</h2>
      {space.youMay === 'log' || space.youMay === 'manage' ? <span className={styles.role}>{t(`start.guest.may.${space.youMay}`)}</span> : null}
    </div>
  );
}
