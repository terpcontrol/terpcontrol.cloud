import { useTranslation } from 'react-i18next';
import { API_URL } from '@/api/config';
import styles from './Claim.module.css';

/** Where an old module that offers no "Change Server" yet gets the firmware that does. */
const FIRMWARE_GUIDE = 'https://github.com/terpcontrol/terpcontrol.cloud/blob/master/UPGRADING-FIRMWARE.md';

/**
 * The way across for a module still talking to the old Fridge Grow 2.0 /
 * Plantalytix cloud: until it is pointed at this server it shows no claim code
 * at all, so the steps stand folded wherever a code is asked for - the claim's
 * first step and the empty home. The address to type is this install's own.
 */
export function LegacyMove({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <details className={`${styles.legacy} ${className ?? ''}`}>
      <summary>{t('legacyMove.toggle')}</summary>
      <p>{t('legacyMove.intro')}</p>
      <ol>
        <li>
          {t('legacyMove.changeServer')} {t('legacyMove.noChangeServer')}{' '}
          <a href={FIRMWARE_GUIDE} target="_blank" rel="noopener noreferrer">
            {t('legacyMove.firmware')}
          </a>
          {t('legacyMove.noChangeServerEnd')}
        </li>
        <li>
          {t('legacyMove.address')} <code className={`mono ${styles.address}`}>{API_URL}</code>
          {/* The module's field starts out as "http://", and the "s" goes in only once the "://" is gone. */}
          {API_URL.startsWith('https://') ? t('legacyMove.addressEnd') : '.'}
        </li>
        <li>{t('legacyMove.password')}</li>
        <li>{t('legacyMove.update')}</li>
        <li>{t('legacyMove.failed')}</li>
        <li>{t('legacyMove.portal')}</li>
      </ol>
    </details>
  );
}
