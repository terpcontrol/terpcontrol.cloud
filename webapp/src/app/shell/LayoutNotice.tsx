import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import ui from '@/ui/ui.module.css';
import { useWideWindow } from '@/ui/wide-window';
import type { LayoutNews } from './layout-news';
import { useTabs } from './tabs';
import styles from './LayoutNotice.module.css';

/** What moved, said once (`layout-news.ts`): a sentence per change, "Verstanden", and where the diary is switched off again. */
export function LayoutNotice({ news, onClose }: { news: LayoutNews; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const wide = useWideWindow();
  const items = new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(
    useTabs()
      .filter(tab => !tab.log)
      .map(tab => t(tab.labelKey)),
  );

  return (
    <section className={styles.notice} role="status" aria-label={t('shell.layout.label')}>
      <Sparkles size={16} strokeWidth={2} aria-hidden className={styles.icon} />
      <div className={`${ui.stack2} ${styles.text}`}>
        {news.before ? <p>{t(wide ? 'shell.layout.before.wide' : 'shell.layout.before.phone', { items })}</p> : null}
        {news.diary ? <p>{t('shell.layout.diary')}</p> : null}
        {news.places ? <p>{t('shell.layout.places', { count: news.count })}</p> : null}
        <p className={styles.actions}>
          <button type="button" className={ui.button} onClick={onClose}>
            {t('shell.layout.ok')}
          </button>
          {news.diary ? (
            <Link to="/me/diary" className={ui.headLink} onClick={onClose}>
              {t('shell.layout.diaryOff')}
            </Link>
          ) : null}
        </p>
      </div>
    </section>
  );
}
