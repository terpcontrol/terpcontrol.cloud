import { ChevronLeft, Download } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { fileSize, isBuilding, useAskAccountExport, useExport } from '@/api/exports';
import { mediaUrl } from '@/api/session';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import styles from './parts.module.css';

/**
 * What every page below Me is built from: the page with its title and the way
 * back, the setting row, the menu in a chip, and the row that exports the
 * account.
 *
 * Every page under Me shares this one, so that a row on Appearance and a row
 * on Account are the same row and not two that drifted, and so that the way
 * back is fixed once. They are deliberately the same shapes, to the pixel: a
 * person walking from one page to the next should not be able to tell where
 * one slice of the work ended and another began.
 */

/**
 * The page: its title, the chevron back to Me, and on a width that has room
 * for it the trail as well. The chevron is there at every width because the
 * phone's top bar carries no way back - the wordmark, the bell and the avatar
 * - and a leaf route with no exit but the browser's own gesture is a dead end
 * in an installed app.
 */
export function MePage({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <Link to="/me" className={styles.back} aria-label={t('me.title')}>
          <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
        </Link>
        <h1 className={styles.title}>{title}</h1>
        <span className={`mono ${styles.crumb}`}>
          <Link to="/me">{t('me.title')}</Link> › {title}
        </span>
      </header>
      {children}
    </section>
  );
}

/**
 * A setting: what it is, one line saying what it does or what it says today,
 * and the control at the right. What a control opens - a form, a question, a
 * list - goes underneath, inside the same card, so that the column at rest
 * reads as a list of equal things.
 */
export function Row({
  title,
  line,
  danger,
  children,
  below,
}: {
  title: string;
  line: ReactNode;
  danger?: boolean;
  /** The control at the right. */
  children?: ReactNode;
  /** What the control opened, under the head. */
  below?: ReactNode;
}) {
  return (
    <div className={`${ui.card} ${styles.row}`} data-danger={danger ? '' : undefined}>
      <div className={styles.rowHead}>
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>{title}</span>
          <span className={`${ui.note} ${styles.rowLine}`}>{line}</span>
        </div>
        {children ? <div className={styles.rowControl}>{children}</div> : null}
      </div>
      {below}
    </div>
  );
}

/**
 * A chip that is a menu: the native select, keeping its keyboard and the
 * platform's own picker, giving up only its arrow and its padding. The options
 * are the caller's, because a menu of units and a menu of languages have
 * nothing in common but the shape.
 */
export function Menu({
  name,
  value,
  disabled,
  onChange,
  children,
}: {
  name: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      className={`mono ${ui.chip} ${styles.menu}`}
      value={value}
      aria-label={name}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}

/**
 * Everything the account has, as a file. The zip is built in the background,
 * so this is a button and then a job: the row it is asked for is polled until
 * it is ready or has failed, and a failure says what went wrong rather than
 * sitting at "building" for ever - the same shape, and the same polling, as
 * the export at the end of a grow's report. Two pages promise this export, the
 * account and the privacy screen, so it is one row with two sets of words
 * rather than two rows that could be told apart. The control is a chip like
 * every other control in the column, and turns green once there is a file.
 */
export function ExportRow({ title, line, ask }: { title: string; line: ReactNode; ask: string }) {
  const { t } = useTranslation();
  const request = useAskAccountExport();
  const [mediaId, setMediaId] = useState<string | null>(null);
  const job = useExport(mediaId);

  const row = job.data;
  const status = row?.exportJob?.status ?? null;
  const ready = row && status === 'ready' ? row : null;
  const file = ready ? mediaUrl(ready.id) : null;

  return (
    <Row
      title={title}
      line={line}
      below={
        <>
          {status === 'queued' || status === 'rendering' ? (
            <p className={`mono ${styles.exportStatus}`} role="status">
              {t(`me.account.export.${status}`)}
            </p>
          ) : null}
          {status === 'failed' ? (
            <p className={ui.problem} role="alert">
              {row?.exportJob?.error || t('me.account.export.failedPlain')}
            </p>
          ) : null}
          <Refused error={request.error} />
        </>
      }
    >
      {ready && file ? (
        <a className={`${ui.chip} ${ui.primary}`} href={file} download>
          <Download size={14} strokeWidth={1.75} aria-hidden />
          {t('me.account.export.download', { size: fileSize(ready.bytes) })}
        </a>
      ) : (
        <button
          type="button"
          className={ui.chip}
          disabled={request.isPending || isBuilding(row)}
          onClick={() => request.mutate(undefined, { onSuccess: accepted => setMediaId(accepted.media.id) })}
        >
          {status === 'failed' ? t('me.account.export.again') : ask}
        </button>
      )}
    </Row>
  );
}
