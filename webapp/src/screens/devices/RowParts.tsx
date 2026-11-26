import styles from './Devices.module.css';
import ui from '@/ui/ui.module.css';

/** What a page has to say about hardware: one fact per line, its name on the left and the figure on the right. */
export function Facts({ children }: { children: React.ReactNode }) {
  return <dl className={styles.facts}>{children}</dl>;
}

export function Fact({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className={`${ui.headRow} ${styles.fact}`}>
      <dt className="label">{label}</dt>
      <dd className={styles.factValue}>{value}</dd>
    </div>
  );
}
