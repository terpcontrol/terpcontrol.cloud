import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { LayoutSeen } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useSeeLayout } from '@/api/layers';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { newsOf, useShape } from './shape';
import styles from './LayoutNotice.module.css';

/**
 * Two things rearrange the app under a grower's thumb: the diary coming in,
 * which puts the green Eintrag button in the middle of the bar and a grow block
 * on the place, and a second place, which turns Start from that place's
 * cockpit into a card per place and puts a switcher on Verlauf and Steuerung.
 * Either is said once, the first time the app is opened after it, in a line
 * that names what moved and where the rest went - never a silent flip.
 *
 * The shape the account was last shown is kept with the account, so the line
 * comes once and not once per phone. An account seen for the first time is
 * recorded as it stands and told nothing: nothing changed for it. What goes
 * away - a place given up, the diary switched off by its owner - is recorded
 * without a word, because the person did it.
 */
export function LayoutNotice() {
  const { t } = useTranslation();
  const mayWrite = useMayManage();
  const me = useMe(false, mayWrite);
  const shape = useShape();
  const see = useSeeLayout();
  const [news, setNews] = useState<{ news: LayoutSeen; places: number } | null>(null);
  const recorded = useRef<string | null>(null);

  const account = me.data;
  const { ready, diary, places } = shape;
  const { mutate } = see;

  useEffect(() => {
    if (!mayWrite || !ready || !account) return;
    const now: LayoutSeen = { diary, places: places > 1 };
    const seen = account.preferences.layoutSeen ?? null;
    const key = `${now.diary}:${now.places}`;
    if ((seen !== null && seen.diary === now.diary && seen.places === now.places) || recorded.current === key) return;

    recorded.current = key;
    const told = newsOf(seen, now);
    // Said whether or not the write lands: a server that did not keep it says it again next time, which is no worse.
    mutate(now, { onSettled: () => told && setNews({ news: told, places }) });
  }, [mayWrite, ready, account, diary, places, mutate]);

  if (!news) return null;

  return (
    <section className={styles.notice} role="status" aria-label={t('shell.layout.label')}>
      <Sparkles size={16} strokeWidth={2} aria-hidden className={styles.icon} />
      <div className={styles.text}>
        {news.news.diary ? <p>{t('shell.layout.diary')}</p> : null}
        {news.news.places ? <p>{t('shell.layout.places', { count: news.places })}</p> : null}
        <p className={styles.actions}>
          <button type="button" className={`${ui.button} ${styles.ok}`} onClick={() => setNews(null)}>
            {t('shell.layout.ok')}
          </button>
          {news.news.diary ? (
            <Link to="/me/appearance" className={ui.headLink} onClick={() => setNews(null)}>
              {t('shell.layout.diaryOff')}
            </Link>
          ) : null}
        </p>
      </div>
    </section>
  );
}
