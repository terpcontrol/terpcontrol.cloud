import { useTranslation } from 'react-i18next';
import { useChooseDiary } from '@/api/layers';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import styles from './DiaryOffer.module.css';

/**
 * Where the diary is not in use, it is offered once, in one grey line under
 * everything, rather than a third of every card: "Grow-Tagebuch einschalten"
 * turns it on - named as the switch it is, with no chevron that would promise
 * a page to read first - and the card grows its invitations right where it
 * stands, and "no thanks"
 * is kept with the account, so the line does not come back on the next phone.
 * Either answer can be changed again under Me › Appearance.
 */
export function DiaryOffer() {
  const { t } = useTranslation();
  const choose = useChooseDiary();

  return (
    <div className={styles.offer}>
      <p className={`${styles.line} ${ui.dots}`}>
        <button type="button" className={styles.start} disabled={choose.isPending} onClick={() => choose.mutate('on')}>
          {t('home.diary.offer')}
        </button>
        <span className={ui.dot}>
          {' · '}
          <button type="button" className={styles.decline} disabled={choose.isPending} onClick={() => choose.mutate('off')}>
            {t('home.diary.decline')}
          </button>{' '}
          <Help topic="diaryLayer" />
        </span>
      </p>
      <Refused error={choose.error} />
    </div>
  );
}
