import { useLayoutEffect, type ReactNode } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { BackLink } from './BackLink';
import styles from './PageHead.module.css';

/**
 * A page opened anew starts at its top: nothing else puts it there, and one
 * opened from a row far down the page before it stood as far down itself. A
 * page come back to is put where it was left by whoever keeps that
 * (`useKeptScroll`, `ui/kept.ts`), so only a step forward is answered here.
 */
const useStartsAtTop = () => {
  const { key } = useLocation();
  const opened = useNavigationType() === 'PUSH';

  useLayoutEffect(() => {
    if (opened && window.scrollY > 0) window.scrollTo(0, 0);
  }, [key, opened]);
};

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
  useStartsAtTop();

  return (
    <header className={styles.head}>
      <BackLink to={back.to} label={back.label} />
      <h1 data-title={of ? `${title} · ${of}` : undefined}>{title}</h1>
      {children}
      {of ? <p className={styles.of}>{of}</p> : null}
    </header>
  );
}
