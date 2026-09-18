import { useTranslation } from 'react-i18next';
import type { GrowListItem } from '@fg2/shared-types/v1';
import ui from '@/ui/ui.module.css';
import { amountLabel, schemeName } from './scheme';
import styles from './GrowPage.module.css';

/**
 * The Feeding tab: the scheme's weeks as the grow stores them. The grow
 * carries its own copy of the grid, so what is shown is what the week cards
 * were fed from, whatever happened to the scheme it came from since.
 */
export function Feeding({ grow }: { grow: GrowListItem }) {
  const { t } = useTranslation();
  const scheme = grow.scheme;

  if (!scheme) {
    return (
      <section className={`${ui.cardDashed} ${styles.later}`}>
        <span className="label">{t('grow.noScheme')}</span>
        <p className={ui.note}>{t('grow.noSchemeNote')}</p>
      </section>
    );
  }

  return (
    <div className={styles.cards}>
      <p className={`mono ${styles.schemeLine}`}>
        {schemeName(grow, t)}
        {scheme.edited ? ` · ${t('grow.edited')}` : ''}
        {` · ${t('grow.strength', { percent: Math.round(scheme.strength * 100) })}`}
        {scheme.waterEc !== null ? ` · ${t('grow.waterEc', { ec: scheme.waterEc })}` : ''}
        {scheme.flipWeek !== null ? ` · ${t('grow.flipWeek', { week: scheme.flipWeek })}` : ''}
      </p>
      <ul className={styles.rows} aria-label={t('grow.tabs.feeding')}>
        {scheme.grid.map(week => {
          const current = week.week === grow.summary.weekNumber;
          return (
            <li key={week.week} className={styles.row} data-current={current}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>
                  {t('grow.weekN', { week: week.week })}
                  {week.stage ? <span className={styles.muted}> · {t(`home.stage.${week.stage}`)}</span> : null}
                  {current ? <span className={`mono ${styles.thisWeekTag}`}>{t('grow.thisWeek')}</span> : null}
                </span>
                <span className={styles.rowSub}>
                  {week.amounts
                    .filter(amount => amount.value !== null)
                    .map(amountLabel)
                    .join(' · ') || t('grow.nothingThisWeek')}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
