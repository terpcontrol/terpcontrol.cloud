import ui from '@/ui/ui.module.css';
import styles from './Admin.module.css';

/**
 * The one row a table draws when a filter has emptied it.
 *
 * A column header over nothing reads at a glance as a fleet that has gone,
 * and the only other word on the screen - "showing 0 of 25 loaded" in small
 * grey under the card - is easy to miss. So the row says that nothing matched
 * and what was looked for, inside the table where the rows were, and offers
 * to show everything again in one press. It is the dashed card every other
 * list in the app draws when it is empty only because of what was asked of
 * it, and both admin tables use this one rather than each drawing its own.
 */
export function NoMatch({ columns, line, clear, onClear }: { columns: number; line: string; clear?: string; onClear?: () => void }) {
  return (
    <tr>
      <td colSpan={columns} className={styles.noMatchCell}>
        <div className={`${ui.cardDashed} ${styles.noMatch}`}>
          <span className={ui.note}>{line}</span>
          {clear && onClear ? (
            <button type="button" className={ui.chip} onClick={onClear}>
              {clear}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
