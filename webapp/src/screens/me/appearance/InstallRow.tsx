import { Share } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { useInstall } from '@/app/install';
import ui from '@/ui/ui.module.css';
import { Row } from '../parts';
import styles from './Appearance.module.css';

/** Where a link to the steps points, so that the push card on an iPhone can open them. */
export const INSTALL_ANCHOR = 'install';

/**
 * Terp Control on the home screen: one tap where the browser offers its own
 * dialog, the steps where it does not - which is every iPhone, and there it is
 * also the only way push notifications arrive at all. Opened from such a link,
 * the steps are unfolded already.
 */
export function InstallRow() {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const install = useInstall();
  const [open, setOpen] = useState(hash === `#${INSTALL_ANCHOR}`);

  if (install.standalone) return <Row title={t('install.title')} line={t('install.running')} help="installApp" />;

  return (
    <div id={INSTALL_ANCHOR}>
      <Row
        title={t('install.title')}
        line={t(install.ios ? 'install.lineIos' : 'install.line')}
        help="installApp"
        below={open && !install.canPrompt ? <InstallSteps ios={install.ios} /> : null}
      >
        {install.canPrompt ? (
          <button type="button" className={ui.chip} onClick={() => void install.prompt()}>
            {t('install.now')}
          </button>
        ) : (
          <button type="button" className={ui.chip} aria-expanded={open} onClick={() => setOpen(!open)}>
            {t(open ? 'install.hide' : 'install.how')}
          </button>
        )}
      </Row>
    </div>
  );
}

/** The steps for the browser in hand: Safari's share sheet on an iPhone, the browser's menu everywhere else. */
function InstallSteps({ ios }: { ios: boolean }) {
  const { t } = useTranslation();

  return (
    <div className={styles.install}>
      <p className={ui.note}>{t(ios ? 'install.iosIntro' : 'install.androidIntro')}</p>
      <ol className={styles.steps}>
        {ios ? (
          <>
            <li>
              {t('install.iosStep1')} <Share size={14} strokeWidth={1.75} aria-hidden className={styles.shareIcon} />
            </li>
            <li>{t('install.iosStep2')}</li>
            <li>{t('install.iosStep3')}</li>
          </>
        ) : (
          <>
            <li>{t('install.androidStep1')}</li>
            <li>{t('install.androidStep2')}</li>
          </>
        )}
      </ol>
      <p className={ui.note}>{t(ios ? 'install.iosPush' : 'install.note')}</p>
    </div>
  );
}
