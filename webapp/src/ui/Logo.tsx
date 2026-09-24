import styles from './Logo.module.css';

/**
 * The brand's logo, as terpcontrol.com shows it: in colour on a light surface,
 * reversed - white, its green kept - on a dark one (scripts/derive-logo.mjs).
 * Both are drawn and `--logo-colour` / `--logo-reverse` say which one shows, so
 * it follows the theme, and a surface that is dark in both modes, such as the
 * rail, says so by setting the two itself. Its height is the caller's, in
 * `--logo-height`.
 */
export function Logo() {
  return (
    <span className={styles.logo}>
      <img className={styles.colour} src="/assets/brand/logo.png" alt="Terp Control" width={960} height={196} />
      <img className={styles.reverse} src="/assets/brand/logo-reverse.png" alt="Terp Control" width={960} height={196} />
    </span>
  );
}
