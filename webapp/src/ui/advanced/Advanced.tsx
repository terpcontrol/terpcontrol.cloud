import { useTranslation } from 'react-i18next';
import ui from '@/ui/ui.module.css';
import { type AdvancedContexts, type AdvancedItem, type AdvancedScope } from './item';
import { itemsFor } from './registry';
import styles from './Advanced.module.css';

/**
 * A collapsed Erweitert section with the items its scope offers here, or
 * nothing at all where none of them applies. It opens on a tap like the
 * technical details beside it, and what is in it writes on the tap: there is
 * no save bar to find at the bottom of a folded section.
 */
export function AdvancedSection<S extends AdvancedScope>({
  scope,
  context,
  className,
  items,
}: {
  scope: S;
  context: AdvancedContexts[S];
  className?: string;
  /** In place of what the registry found; for a test. */
  items?: readonly AdvancedItem[];
}) {
  const { t } = useTranslation();
  const shown = itemsFor(scope, context, items);
  if (shown.length === 0) return null;

  return (
    <details className={`${styles.section} ${className ?? ''}`} data-advanced={scope}>
      <summary className="label">{t('advanced.title')}</summary>
      <p className={`${ui.note} ${styles.lead}`}>{t(`advanced.lead.${scope}`)}</p>
      <div className={styles.items}>
        {shown.map(({ id, Item }) => (
          <Item key={id} {...context} />
        ))}
      </div>
    </details>
  );
}
