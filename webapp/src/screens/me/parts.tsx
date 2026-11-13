import { Download } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Me } from '@fg2/shared-types/v1';
import { useAccountMe, useUpdatingMe } from '@/api/account';
import { EXPORT_FRESH_MS, exportFilename, useAskAccountExport, useAskedExport, useDownloadExport } from '@/api/exports';
import { isBuilding, useMedia } from '@/api/media';
import { noLongerThere } from '@/api/problem';
import { useSession } from '@/api/session';
import { ageLabel } from '@/ui/age';
import type { HelpTopic } from '@/ui/explain';
import { fileSize } from '@/ui/figures';
import { Help } from '@/ui/Help';
import { LoadFailed, Refused, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { ALL_GROWS } from '@/app/places';
import { PageHead } from '@/ui/PageHead';
import styles from './parts.module.css';

/**
 * What every page below Ich is built from: the page with its head and the way
 * back, the setting row, the menu in a chip, and the row that exports the
 * account; how a save is answered is `useSaveAccount` (`save.ts`). One set of parts, so that a row on
 * Darstellung and a row on Konto are the same row.
 */

/**
 * The page: the arrow back and its title. A page with something to keep that
 * the demo has none of says so in `demo`, and the demo is shown that line in
 * place of the page. `grows` is a page that belongs to growing rather than to
 * the account - the feeding schemes, the share links, the grows somebody
 * follows - and is reached from "Alle Grows", so that is where it leads back.
 */
export function MePage({ title, demo, grows = false, children }: { title: string; demo?: string; grows?: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const back = grows ? { to: ALL_GROWS, label: t('grow.all.back') } : { to: '/me', label: t('me.backHere') };

  return (
    <section className={`${ui.stack3} ${styles.page}`}>
      <PageHead back={back} title={title} />
      {demo !== undefined && user?.isDemo === true ? <p className={`${ui.cardDashed} ${ui.note}`}>{demo}</p> : children}
    </section>
  );
}

/**
 * The account itself, drawn from `/me`: waited for, said when it could not be
 * read, and handed over with whether its controls hold still - while this
 * session may not manage the account, and while a change is on its way,
 * because every write is the whole object and two crossing would each carry
 * the other's old state back.
 */
export function AccountRead({ lines, children }: { lines: number; children: (me: Me, held: boolean) => ReactNode }) {
  const now = useNow();
  const me = useAccountMe();
  const mayManage = useMayManage();
  const updating = useUpdatingMe();

  if (me.isPending) return <Waiting lines={lines} />;
  if (!me.data) return <LoadFailed retry={() => void me.refetch()} />;

  return (
    <>
      <RefreshFailed failedAt={me.isError ? me.dataUpdatedAt : null} now={now} />
      {children(me.data, !mayManage || updating)}
    </>
  );
}

/** A page about the account itself, which the demo has none of. */
export function AccountPage({ title, demo, children }: { title: string; demo: string; children: (me: Me, held: boolean) => ReactNode }) {
  return (
    <MePage title={title} demo={demo}>
      <AccountRead lines={4}>{children}</AccountRead>
    </MePage>
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
  help,
  children,
  below,
}: {
  title: string;
  line: ReactNode;
  danger?: boolean;
  /** What the title and its line cannot say, as the (i) beside the title. */
  help?: HelpTopic;
  /** The control at the right. */
  children?: ReactNode;
  /** What the control opened, under the head. */
  below?: ReactNode;
}) {
  return (
    <div className={`${ui.card} ${ui.joined} ${ui.stack3} ${styles.row}`} data-danger={danger ? '' : undefined}>
      <div className={`${ui.wrapRow} ${styles.rowHead}`}>
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>
            {title}
            {help ? <Help topic={help} /> : null}
          </span>
          {line ? <span className={`${ui.note} ${styles.rowLine}`}>{line}</span> : null}
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
  className,
  onChange,
  children,
}: {
  name: string;
  value: string;
  disabled?: boolean;
  /** A ceiling for a menu whose options are long enough to decide the row's width. */
  className?: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      className={`${ui.chip} ${ui.menu} ${className ?? ''}`}
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
 * so this is a button and then a job: its row is polled until it is ready or
 * has failed, and a failure says what went wrong - the same shape as the
 * export at the end of a grow's report. What the file holds is behind the
 * help button.
 *
 * Which job it draws comes from the cache and from what this browser kept
 * (`useAskedExport`). The chip carries the file's age, and a new one is
 * offered beside a file older than the hour the route answers it unchanged
 * for: a zip from before this morning's entry must not be the only thing to
 * take. A kept file that is no longer there is no file, and not a refusal.
 */
export function ExportRow() {
  const { t } = useTranslation();
  const now = useNow();
  const request = useAskAccountExport();
  const mediaId = useAskedExport();
  const job = useMedia(mediaId);

  const download = useDownloadExport();
  const row = job.data;
  const status = row?.exportJob?.status ?? null;
  const ready = row && status === 'ready' ? row : null;
  const built = ready ? (ready.exportJob?.endedAt ?? ready.createdAt) : null;
  const fresh = built !== null && now.toMillis() - Date.parse(built) < EXPORT_FRESH_MS;

  return (
    <Row
      title={t('me.account.export.title')}
      line={t('me.account.export.line')}
      help="accountExport"
      below={
        <>
          {status === 'queued' || status === 'rendering' ? (
            <p className={styles.exportStatus} role="status">
              {t(`me.account.export.${status}`)}
            </p>
          ) : null}
          {status === 'failed' ? (
            <p className={ui.problem} role="alert">
              {row?.exportJob?.error || t('me.account.export.failedPlain')}
            </p>
          ) : null}
          <Refused error={request.error} />
          {/* A poll that stopped answering leaves the last row in place, so it has to say so rather than sit at "building the file…" for ever. */}
          <Refused error={noLongerThere(job.error) ? null : job.error} />
          <Refused error={download.error} />
        </>
      }
    >
      {ready ? (
        <button
          type="button"
          className={`${ui.chip} ${ui.primary}`}
          disabled={download.isPending}
          onClick={() => download.mutate({ mediaId: ready.id, filename: exportFilename(ready) })}
        >
          <Download size={14} strokeWidth={1.75} aria-hidden />
          {t('me.account.export.download', { size: fileSize(ready.bytes), age: ageLabel(built!, now) })}
        </button>
      ) : null}
      {fresh ? null : (
        <button type="button" className={ui.chip} disabled={request.isPending || isBuilding(row)} onClick={() => request.mutate()}>
          {status === 'failed' ? t('home.retry') : t('me.account.export.ask')}
        </button>
      )}
    </Row>
  );
}
