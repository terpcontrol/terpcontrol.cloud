import { useTranslation } from 'react-i18next';
import ui from '@/ui/ui.module.css';
import styles from './Members.module.css';

/** What each of the three may do, in the order the board reads them: seeing, logging, steering, owning. */
const ROWS = ['see', 'log', 'steer', 'own'] as const;

/** Whether the column may do the row. The owner may do everything, so its column is not stated. */
const MAY: Record<(typeof ROWS)[number], { manage: boolean; log: boolean }> = {
  see: { manage: true, log: true },
  log: { manage: true, log: true },
  steer: { manage: true, log: false },
  own: { manage: false, log: false },
};

/**
 * The table that answers the question a role name never quite does: what is the
 * difference, in the tent, between the two.
 *
 * It is drawn as a table rather than as three lists because the reading is
 * across - the one row where the columns differ is the one somebody is looking
 * for. The note under it is there because the table would otherwise invite a
 * fourth column: read-only viewing is a share link and not a role, and the
 * reasons are in the sentence rather than in a tooltip nobody opens.
 */
export function Permissions() {
  const { t } = useTranslation();

  return (
    <section className={styles.permissions}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col" className={`mono ${styles.column}`}>
              {t('space.members.roleShort.owner')}
            </th>
            <th scope="col" className={`mono ${styles.column}`}>
              {t('space.members.roleShort.can_manage')}
            </th>
            <th scope="col" className={`mono ${styles.column}`}>
              {t('space.members.roleShort.can_log')}
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(row => (
            <tr key={row}>
              <th scope="row" className={styles.can}>
                {t(`space.members.can.${row}`)}
              </th>
              <Mark yes />
              <Mark yes={MAY[row].manage} />
              <Mark yes={MAY[row].log} />
            </tr>
          ))}
        </tbody>
      </table>
      <p className={ui.note}>{t('space.members.noViewerRole')}</p>
    </section>
  );
}

/**
 * A dot for yes and a dash for no, with the word behind it for a reader who
 * hears the table rather than sees it - a bullet read aloud says nothing.
 */
function Mark({ yes }: { yes: boolean }) {
  const { t } = useTranslation();

  return (
    <td className={styles.mark}>
      <span aria-hidden>{yes ? '●' : '–'}</span>
      <span className={styles.markWord}>{t(yes ? 'space.members.mark.yes' : 'space.members.mark.no')}</span>
    </td>
  );
}
