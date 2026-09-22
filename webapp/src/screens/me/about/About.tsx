import { useTranslation } from 'react-i18next';
import { API_URL, APP_VERSION, BUILD_MODE, CUSTOM_LINKS_HTML } from '@/api/config';
import ui from '@/ui/ui.module.css';
import { versionLine } from '../doors';
import { MePage, Row } from '../parts';
import styles from './About.module.css';

/**
 * Me › About: what this install is.
 *
 * Three facts and nothing invented: the version and kind of build this bundle
 * is, the server it talks to, and the links whoever built the image wrote for
 * it - an imprint, its terms, a privacy statement. An install that wrote none
 * has no links card at all rather than an empty one, and there is no line for
 * a manual because no install answers where one is.
 */
export function About() {
  const { t } = useTranslation();

  return (
    <MePage title={t('me.about.title')}>
      <Row title={t('me.about.app')} line={<span className="mono">{versionLine(t, APP_VERSION, BUILD_MODE)}</span>} />
      <Row title={t('me.about.server')} line={<span className="mono">{API_URL}</span>} />
      {CUSTOM_LINKS_HTML ? (
        <section className={`${ui.card} ${styles.links}`}>
          <span className="label">{t('me.about.links')}</span>
          <div className={styles.linksBody} dangerouslySetInnerHTML={{ __html: CUSTOM_LINKS_HTML }} />
        </section>
      ) : null}
    </MePage>
  );
}
