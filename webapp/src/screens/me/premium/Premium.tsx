import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Camera, Me } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useCameras } from '@/api/cameras';
import { useSession } from '@/api/session';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { countdownDays, dayLabel, renewalDue } from './entitlement';
import styles from './Premium.module.css';

/**
 * Me › Premium: what each camera is entitled to and why, what Premium covers,
 * and the one button that leaves the app.
 *
 * Everything on it is read, never inferred. A camera is entitled because the
 * server answers `tier: premium`, not because its date is still ahead; the
 * sentence under its name comes from `grant`, which is the record of why it
 * was given a year; and a countdown is drawn only where `renewalVisible`
 * allows one. Nothing here renews anything: this server does no billing, so
 * the button is a link to wherever the install says, and where it says
 * nowhere there is no button.
 *
 * An install that does not enforce Premium - which is every self-hosted one -
 * gets a different page from the same parts. Every camera has everything, so
 * no date, no countdown and no button are drawn, because each of them would be
 * a promise or a threat about something that does not happen here.
 */

/** What a cell of the table says: a dot, a dash, or one of the board's short words. */
type Cell = 'yes' | 'no' | 'sd' | 'mp' | 'limited' | 'wholeGrow' | 'watermark';

/**
 * The table, row for row as the board draws it. The one departure is the free
 * window of "Stills kept": the board writes a number of days, but that window
 * is the hosted install's configuration and no route answers it, so the cell
 * says the stills are kept for a limited time and names no figure the server
 * has not given.
 */
const ROWS: { key: string; free: Cell; premium: Cell }[] = [
  { key: 'live', free: 'yes', premium: 'yes' },
  { key: 'resolution', free: 'sd', premium: 'mp' },
  { key: 'kept', free: 'limited', premium: 'wholeGrow' },
  { key: 'wholeGrowHd', free: 'no', premium: 'yes' },
  { key: 'reel', free: 'watermark', premium: 'yes' },
  { key: 'rtsp', free: 'no', premium: 'yes' },
  { key: 'rest', free: 'yes', premium: 'yes' },
];

export function Premium() {
  const { t } = useTranslation();
  const { user } = useSession();

  const header = (
    <header className={styles.head}>
      <h1 className={styles.title}>{t('me.premium.title')}</h1>
      <span className={`mono ${styles.crumb}`}>
        <Link to="/me">{t('me.title')}</Link> › {t('me.premium.title')}
      </span>
    </header>
  );

  // The demo has no account and no cameras of its own to be entitled, so it is
  // told that and asked nothing on its behalf; the table is still worth reading.
  if (user?.isDemo === true) {
    return (
      <section className={styles.page}>
        {header}
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.premium.demo')}</p>
        <Covers />
        <p className={ui.note}>{t('me.premium.perCamera')}</p>
      </section>
    );
  }

  return <Account header={header} />;
}

/** The page for somebody with an account: their cameras against the install's word on Premium. */
function Account({ header }: { header: React.ReactNode }) {
  const { t } = useTranslation();
  const now = useNow();
  const me = useMe();
  const cameras = useCameras();

  if (me.isPending || cameras.isPending) {
    return (
      <section className={styles.page}>
        {header}
        <Waiting lines={4} />
      </section>
    );
  }

  if (!me.data || !cameras.data) {
    return (
      <section className={styles.page}>
        {header}
        <LoadFailed
          retry={() => {
            void me.refetch();
            void cameras.refetch();
          }}
        />
      </section>
    );
  }

  const premium = me.data.premium;
  const list = cameras.data.items;
  const failedAt = me.isError ? me.dataUpdatedAt : cameras.isError ? cameras.dataUpdatedAt : null;
  // The price is shown once a camera has a reason to want it and not before,
  // which is what the board's button promises in its own caption.
  const due = premium.enforced && list.some(camera => renewalDue(camera, now));

  return (
    <section className={styles.page}>
      {header}
      <RefreshFailed failedAt={failedAt} now={now} />

      {!premium.enforced ? <p className={`${ui.card} ${styles.lead}`}>{t('me.premium.ungated')}</p> : null}

      {list.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.premium.noCameras')}</p>
      ) : (
        <ul className={styles.cameras}>
          {list.map(camera => (
            <CameraCard key={camera.id} camera={camera} enforced={premium.enforced} now={now} />
          ))}
        </ul>
      )}

      <Covers />
      <p className={ui.note}>{t('me.premium.perCamera')}</p>

      {premium.enforced ? <Extend premium={premium} due={due} /> : null}
    </section>
  );
}

/**
 * One camera: what it is, whether it is entitled and until when, and in one
 * sentence why - or, for one that is not, what it is missing in its own
 * words. On an install that gates nothing the date is not the news and is
 * not drawn: the camera has everything whatever its record says.
 */
function CameraCard({ camera, enforced, now }: { camera: Camera; enforced: boolean; now: DateTime }) {
  const { t } = useTranslation();
  const { tier, validUntil } = camera.entitlement;
  const entitled = tier === 'premium';
  const days = enforced ? countdownDays(camera, now) : null;

  return (
    <li className={`${ui.card} ${styles.camera}`}>
      <div className={styles.cameraHead}>
        <span className={styles.cameraName}>
          {camera.name}
          <span className={`mono ${styles.kind}`}>· {t(`me.premium.kind.${camera.kind}`)}</span>
          {entitled ? <span className={styles.chip}>{t('me.premium.tier.premium')}</span> : null}
        </span>
        {enforced ? (
          <span className={`mono ${styles.until}`} data-tier={tier}>
            {entitled ? (validUntil ? t('me.premium.until', { date: dayLabel(validUntil) }) : '') : t('me.premium.tier.free')}
          </span>
        ) : null}
      </div>
      <p className={`${ui.note} ${styles.line}`}>{lineOf(t, camera, enforced)}</p>
      {days !== null ? (
        <p className={`mono ${styles.ending}`} role="status">
          {days === 0 ? t('me.premium.endsToday') : t('me.premium.endsIn', { count: days })}
        </p>
      ) : null}
    </li>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The sentence under a camera's name. It is read from `grant`, which is the
 * record of why the year was given, and never worked out from the dates; a
 * camera the server calls entitled without a grant is said to be entitled and
 * nothing more, rather than guessed at.
 */
const lineOf = (t: Translate, camera: Camera, enforced: boolean): string => {
  const { grant, tier, validUntil } = camera.entitlement;
  if (!enforced) return t('me.premium.everything');
  if (tier === 'premium') return t(`me.premium.grant.${grant ?? 'granted'}`);
  if (grant && validUntil) return t('me.premium.ranOut', { date: dayLabel(validUntil) });
  if (camera.kind === 'rtsp') return t('me.premium.rtspFree', { seconds: camera.stillIntervalSeconds });

  return t('me.premium.free');
};

/** The free-versus-Premium table, with the board's note that it is about cameras and nothing else. */
function Covers() {
  const { t } = useTranslation();

  const cell = (value: Cell) => {
    if (value === 'yes' || value === 'no') {
      return (
        <span role="img" aria-label={t(`me.premium.table.${value}`)}>
          {value === 'yes' ? '•' : '–'}
        </span>
      );
    }

    return t(`me.premium.table.${value}`);
  };

  return (
    <section className={styles.covers}>
      <div className={styles.coversHead}>
        <span className="label">{t('me.premium.covers')}</span>
        <span className={`mono ${styles.only}`}>{t('me.premium.camerasOnly')}</span>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <td />
            <th scope="col" className={`label ${styles.cell}`}>
              {t('me.premium.table.free')}
            </th>
            <th scope="col" className={`label ${styles.cell}`}>
              {t('me.premium.table.premium')}
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(row => (
            <tr key={row.key}>
              <th scope="row" className={styles.feature}>
                {t(`me.premium.table.${row.key}`)}
              </th>
              <td className={`mono ${styles.cell}`}>{cell(row.free)}</td>
              <td className={`mono ${styles.cell}`}>{cell(row.premium)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * The way to extend, which is a link out of the app because this server does
 * no billing. The price stands beside it once a camera is due and only where
 * the install has named one; before that the caption says when it will. An
 * install that names nowhere to go gets no button and a line saying whom to
 * ask, rather than a button that opens nothing.
 */
function Extend({ premium, due }: { premium: Me['premium']; due: boolean }) {
  const { t } = useTranslation();

  if (!premium.extendUrl) return <p className={ui.note}>{t('me.premium.nowhereToExtend')}</p>;

  const caption = due ? premium.priceLabel : t('me.premium.priceLater');

  return (
    <a className={`${ui.button} ${styles.extend}`} href={premium.extendUrl} target="_blank" rel="noreferrer">
      {t('me.premium.extend')}
      {caption ? <span className={`mono ${styles.price}`}> · {caption}</span> : null}
    </a>
  );
}
