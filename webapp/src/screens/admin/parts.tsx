import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { fetchedAt } from '@/api/clock';
import { ageLabel, deviceLiveness } from '@/ui/age';
import type { HelpTopic } from '@/ui/explain';
import { Help } from '@/ui/Help';
import { PageHead } from '@/ui/PageHead';
import { LoadFailed, Waiting } from '@/ui/PageState';
import { Tabs } from '@/ui/Tabs';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import styles from './Admin.module.css';

/**
 * A sheet opened from a table's row, drawn at the end of the document: the row's
 * last cell is pinned (`position: sticky`), which makes it a stacking context of
 * its own, so a sheet inside it lay under the pinned cells of every row after it,
 * which stayed bright over the scrim.
 */
export const OutOfTheRow = ({ children }: { children: ReactNode }) => createPortal(children, document.body);

/** The four screens of whoever runs the install, in the order their tabs stand in. */
const SCREENS = ['fleet', 'firmware', 'users', 'demo'] as const;

/**
 * The head of an admin screen: the arrow back to Ich, where "Verwaltung"
 * leads here, its title, a pill that says how old the screen's read is - the
 * fleet moves while it is looked at, and nothing else on the screen dates it -
 * and the four screens as tabs, one step of Back between them. A screen below
 * the fleet's (`of`, one device) leads back to the fleet and has no tabs.
 * Under them stands whatever the screen counts and filters by.
 */
export function AdminHead({
  title,
  of,
  readAt = 0,
  children,
}: {
  title: string;
  of?: string;
  /** When the screen's own read last answered (`dataUpdatedAt`); nothing is dated before it has. */
  readAt?: number;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const now = useNow();
  // The read's instant is the browser's; it is aged on the server's clock like every other age.
  const at = readAt > 0 ? fetchedAt(readAt) : null;

  return (
    <>
      <PageHead title={title} of={of} back={of ? { to: '/admin/fleet', label: t('admin.backToFleet') } : { to: '/me', label: t('me.backHere') }}>
        {at ? (
          <span className={ui.live} data-liveness={deviceLiveness(at, now)}>
            {t('admin.asOf', { age: ageLabel(at, now) })}
          </span>
        ) : null}
      </PageHead>
      {of ? null : <Tabs label={t('admin.section')} items={SCREENS.map(key => ({ key, label: t(`admin.${key}.title`), to: `/admin/${key}` }))} />}
      {children ? <div className={styles.head}>{children}</div> : null}
    </>
  );
}

/** A card's heading with the (i) that says what a paragraph over its controls would. */
export function Label({ text, help }: { text: string; help: HelpTopic }) {
  return (
    <span className="label">
      {text}
      <Help topic={help} />
    </span>
  );
}

/** An admin screen with nothing to show yet: its head over the waiting block, or over the way to try again once the read has failed. */
export function AdminNotLoaded({ head, lines = 4, retry }: { head: ReactNode; lines?: number; retry?: () => void }) {
  return (
    <section className={ui.stack4}>
      {head}
      {retry ? <LoadFailed retry={retry} /> : <Waiting lines={lines} />}
    </section>
  );
}

/** How recently something was heard from, as the coloured dot and the words beside it. */
export function Liveness({ state, children }: { state: string; children: ReactNode }) {
  return (
    <span className={styles.liveness} data-liveness={state}>
      <span className={styles.dot} aria-hidden />
      {children}
    </span>
  );
}
