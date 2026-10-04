import { Help } from '@/ui/Help';
import type { HelpTopic } from '@/ui/explain';
import ui from '@/ui/ui.module.css';
import styles from './Advanced.module.css';

/**
 * One setting: its name and the (i) that explains it on the left, the control
 * on the right, and under them what the current choice means where that needs
 * saying.
 */
export function SettingRow({
  label,
  help,
  note,
  wide = false,
  alone = false,
  children,
}: {
  label: string;
  help?: HelpTopic;
  note?: React.ReactNode;
  /** A row of choices rather than one switch: it takes the line under the name. */
  wide?: boolean;
  /** Drawn on its own rather than in a section's column of rows. */
  alone?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.row} data-wide={wide || undefined} data-alone={alone || undefined}>
      <div className={styles.head}>
        <span className={styles.label}>
          {label}
          {help ? <Help topic={help} /> : null}
        </span>
        {wide ? null : <span className={styles.control}>{children}</span>}
      </div>
      {wide ? children : null}
      {note ? <p className={`${ui.note} ${styles.note}`}>{note}</p> : null}
    </div>
  );
}
