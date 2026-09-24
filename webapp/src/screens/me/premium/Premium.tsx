import { Check } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Camera, Me, PremiumFree } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useCameras } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { cameraTitle } from '@/screens/devices/naming';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { MePage } from '../parts';
import { countdownDays, dayLabel, RENEWAL_NOTICE_DAYS, renewalDue } from './entitlement';
import { missingLine, servedWidthCell, stillsKeptCell } from './free-tier';
import styles from './Premium.module.css';

/**
 * Me › Premium: what each camera is entitled to and why, what Premium covers,
 * and the way out to wherever it is bought.
 *
 * Everything on it is read, never inferred. A camera is entitled because the
 * server answers `tier: premium`, not because its date is still ahead; the
 * sentence under its name comes from `grant`, which is the record of why it
 * was given a year; a countdown is drawn only where `renewalVisible` allows
 * one; and every figure about the free tier - the width stills are served at,
 * the days they are kept - is the install's own answer from `/me`, so the
 * page says what this install does and not what some install might.
 *
 * Premium is per camera, so the offer to extend it stands on the card of the
 * camera it is for and nowhere else. Nothing here renews anything: this server
 * does no billing, so the offer is a link to wherever the install says, and
 * where it says nowhere there is no link.
 *
 * An install that does not enforce Premium - which is every self-hosted one -
 * gets a different page from the same parts. It says so once, at the top, and
 * the cards are then about the cameras: no tier chip, no date, no countdown
 * and no offer, because each of them would be a promise or a threat about
 * something that does not happen here.
 */

/** What a cell of the table says: a dot, a dash, one of the board's short words, or a figure of the install's. */
type Cell = 'yes' | 'no' | 'servedWidth' | 'whole' | 'stillsKept' | 'wholeGrow' | 'watermark';

/**
 * The table, row for row as the board draws it. The board writes a width and
 * a number of days into the free column; both are the install's configuration
 * rather than anything this app knows, so those two cells are read from `/me`
 * and are words where the install has set no figure.
 */
const ROWS: { key: string; free: Cell; premium: Cell }[] = [
  { key: 'live', free: 'yes', premium: 'yes' },
  { key: 'resolution', free: 'servedWidth', premium: 'whole' },
  { key: 'kept', free: 'stillsKept', premium: 'wholeGrow' },
  { key: 'wholeGrowHd', free: 'no', premium: 'yes' },
  { key: 'reel', free: 'watermark', premium: 'yes' },
  { key: 'rtsp', free: 'no', premium: 'yes' },
  { key: 'rest', free: 'yes', premium: 'yes' },
];

export function Premium() {
  const { t } = useTranslation();
  const { user } = useSession();
  const title = t('me.premium.title');

  // The demo has no account and no cameras of its own to be entitled, so it is
  // told that and asked nothing on its behalf; the table is still worth reading.
  if (user?.isDemo === true) {
    return (
      <MePage title={title}>
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.premium.demo')}</p>
        <Covers free={null} />
        <p className={ui.note}>{t('me.premium.perCamera', { days: RENEWAL_NOTICE_DAYS })}</p>
      </MePage>
    );
  }

  return <Account title={title} />;
}

/** The page for somebody with an account: their cameras against the install's word on Premium. */
function Account({ title }: { title: string }) {
  const { t } = useTranslation();
  const now = useNow();
  const me = useMe();
  const cameras = useCameras();
  const devices = useDevices();
  // The tent a camera stands in is the second handle a card needs: two
  // cameras may share a name, and this is the one screen that tells a grower
  // which of them is about to run out.
  const spaces = useSpaces();

  if (me.isPending || cameras.isPending) {
    return (
      <MePage title={title}>
        <Waiting lines={4} />
      </MePage>
    );
  }

  if (!me.data || !cameras.data) {
    return (
      <MePage title={title}>
        <LoadFailed
          retry={() => {
            void me.refetch();
            void cameras.refetch();
          }}
        />
      </MePage>
    );
  }

  const premium = me.data.premium;
  const list = cameras.data.items;
  const failedAt = me.isError ? me.dataUpdatedAt : cameras.isError ? cameras.dataUpdatedAt : null;
  const placeOf = (id: string | null): string | null => spaces.data?.items.find(space => space.id === id)?.name ?? null;
  // Whether any card would carry an offer: where the install has named nowhere
  // to go, that is said once under the list, rather than on every such card.
  const due = premium.enforced && list.some(camera => renewalDue(camera, now));

  return (
    <MePage title={title}>
      <RefreshFailed failedAt={failedAt} now={now} />

      {!premium.enforced ? <p className={`${ui.card} ${styles.lead}`}>{t('me.premium.ungated')}</p> : null}

      {list.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('me.premium.noCameras')}</p>
      ) : (
        <ul className={ui.group}>
          {list.map(camera => (
            <CameraCard
              key={camera.id}
              camera={camera}
              // A camera a controller paired carries that controller's type as
              // its name until somebody renames it, so it is drawn the way
              // every other screen draws it - by what is printed on the cam -
              // rather than as a second row called "controller".
              name={cameraTitle(camera, devices.data?.items.find(device => device.id === camera.deviceId) ?? null, t)}
              place={placeOf(camera.spaceId)}
              premium={premium}
              now={now}
            />
          ))}
        </ul>
      )}

      {due && !premium.extendUrl ? <p className={ui.note}>{t('me.premium.nowhereToExtend')}</p> : null}

      <Covers free={premium.free} />
      <p className={ui.note}>{t('me.premium.perCamera', { days: RENEWAL_NOTICE_DAYS })}</p>
    </MePage>
  );
}

/**
 * One camera: what and where it is, whether it is entitled and until when, in
 * one sentence why - or, for one that is not, what it is missing here in the
 * install's own figures - and, where its year is ending or never began, the
 * offer. The name opens the camera's page, because a card that says a camera
 * needs something should lead to the camera.
 *
 * On an install that gates nothing the tier is not news and is not drawn: the
 * page has said once that every camera has everything, and a chip on each
 * would be the same claim made eleven times about something nobody bought.
 */
function CameraCard({
  camera,
  name,
  place,
  premium,
  now,
}: {
  camera: Camera;
  name: string;
  place: string | null;
  premium: Me['premium'];
  now: DateTime;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const { enforced } = premium;
  const { tier, validUntil } = camera.entitlement;
  const entitled = tier === 'premium';
  const days = enforced ? countdownDays(camera, now) : null;
  const offered = enforced && premium.extendUrl !== null && renewalDue(camera, now);

  return (
    <li className={`${ui.card} ${styles.camera}`}>
      <div className={styles.cameraHead}>
        <span className={styles.cameraName}>
          <Link to={`/cameras/${camera.id}`}>{name}</Link>
          <span className={`mono ${styles.kind}`}>
            · {t(`me.premium.kind.${camera.kind}`)}
            {place ? ` · ${place}` : ''}
          </span>
          {enforced && entitled ? <span className={styles.chip}>{t('me.premium.tier.premium')}</span> : null}
        </span>
        {enforced ? (
          <span className={`mono ${styles.until}`} data-tier={tier}>
            {entitled ? (validUntil ? t('me.premium.until', { date: dayLabel(validUntil, zone) }) : '') : t('me.premium.tier.free')}
          </span>
        ) : null}
      </div>
      <p className={`${ui.note} ${styles.line}`}>{lineOf(t, camera, premium, zone)}</p>
      {days !== null ? (
        <p className={`mono ${styles.ending}`} role="status">
          {days === 0 ? t('me.premium.endsToday') : t('me.premium.endsIn', { count: days })}
        </p>
      ) : null}
      {offered ? <Offer camera={camera} premium={premium} /> : null}
    </li>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The sentence under a camera's name. It is read from `grant`, which is the
 * record of why the year was given, and never worked out from the dates; a
 * camera the server calls entitled without a grant is said to be entitled and
 * nothing more, rather than guessed at. A camera without Premium is told what
 * it is missing in the install's figures, which is the same clause the table
 * reads, so the card and the table cannot disagree.
 */
const lineOf = (t: Translate, camera: Camera, premium: Me['premium'], zone: string | null): string => {
  const { grant, tier, validUntil } = camera.entitlement;
  if (!premium.enforced) return t('me.premium.everything');
  if (tier === 'premium') return t(`me.premium.grant.${grant ?? 'granted'}`);

  const missing = missingLine(t, premium.free);
  if (grant && validUntil) return t('me.premium.ranOut', { date: dayLabel(validUntil, zone), missing });
  if (camera.kind === 'rtsp') return t('me.premium.rtspFree', { seconds: camera.stillIntervalSeconds, missing });

  return t('me.premium.free', { missing });
};

/** The free-versus-Premium table, with the board's note that it is about cameras and nothing else. */
function Covers({ free }: { free: PremiumFree | null }) {
  const { t } = useTranslation();

  const cell = (value: Cell) => {
    if (value === 'servedWidth') return servedWidthCell(t, free);
    if (value === 'stillsKept') return stillsKeptCell(t, free);

    if (value === 'yes' || value === 'no') {
      return (
        <span role="img" aria-label={t(`me.premium.table.${value}`)} className={value === 'yes' ? ui.yes : ui.no}>
          {value === 'yes' ? <Check size={16} strokeWidth={2.25} aria-hidden /> : '–'}
        </span>
      );
    }

    return t(`me.premium.table.${value}`);
  };

  return (
    <section className={styles.covers}>
      <header className={styles.coversHead}>
        <span className="label">{t('me.premium.covers')}</span>
        <span className={`mono ${styles.only}`}>{t('me.premium.camerasOnly')}</span>
      </header>
      <div className={ui.tableCard}>
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
      </div>
    </section>
  );
}

/**
 * The offer, on the card of the camera it is for, because Premium is bought
 * per camera and a grower with two of them has to know which one is being
 * paid for. It is a link out of the app, since this server does no billing;
 * the price stands beside it where the install has named one. A camera that
 * has had a year is offered an extension; one that never had one - an RTSP
 * camera after the migration - has nothing to extend and is offered Premium.
 */
function Offer({ camera, premium }: { camera: Camera; premium: Me['premium'] }) {
  const { t } = useTranslation();

  return (
    <a className={`${ui.button} ${styles.offer}`} href={premium.extendUrl!} target="_blank" rel="noreferrer">
      {camera.entitlement.grant === null ? t('me.premium.get') : t('me.premium.extend')}
      {premium.priceLabel ? <span className={`mono ${styles.price}`}> · {premium.priceLabel}</span> : null}
    </a>
  );
}
