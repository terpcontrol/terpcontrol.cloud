import type { ReactNode } from 'react';
import { BackLink } from './BackLink';
import styles from './PageHead.module.css';

/**
 * The head of a page reached from another: the way back, the page's name and,
 * beside it, what dates the page - the pill of a device or a camera. The name
 * takes the lines it needs, and the pill goes under it before the two meet.
 * `of` names whose page this is where the title alone does not ("Erweitert"
 * of a device); the window is then titled by both.
 */
export function PageHead({
  back,
  title,
  of = null,
  children = null,
}: {
  back: { to: string; label: string };
  title: string;
  of?: string | null;
  children?: ReactNode;
}) {
  return (
    <header className={styles.head}>
      <BackLink to={back.to} label={back.label} />
      <h1 data-title={of ? `${title} · ${of}` : undefined}>{title}</h1>
      {children}
      {of ? <p className={styles.of}>{of}</p> : null}
    </header>
  );
}
