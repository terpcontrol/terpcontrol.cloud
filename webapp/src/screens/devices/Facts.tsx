import styles from './Devices.module.css';

/**
 * What a row has to say once it is opened: one fact per line, the name of it on
 * the left and the figure on the right. A device and a socket both have some,
 * so the shape is stated once.
 */
export function Facts({ children }: { children: React.ReactNode }) {
  return <dl className={styles.facts}>{children}</dl>;
}

export function Fact({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt className="label">{label}</dt>
      <dd className={`mono ${styles.factValue}`}>{value}</dd>
    </div>
  );
}
