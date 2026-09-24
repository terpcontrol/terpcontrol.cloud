import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { Camera, CameraUpdate } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useRemoveCamera, useUpdateCamera } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { countdownDays } from '@/screens/me/premium/entitlement';
import type { HelpTopic } from '@/ui/explain';
import { Help } from '@/ui/Help';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import styles from './CameraPage.module.css';
import { refusalText } from '@/ui/refusal';

/**
 * What the camera itself is set to: how it is reached, what it is pointed at,
 * how long its Premium runs, when it takes a picture and what it says when it
 * stops.
 *
 * How it is reached is what the camera *is* and is stated rather than offered:
 * a Terp Cam is paired at its controller and an RTSP camera is an address, and
 * neither is something this form turns into the other. Somebody who may only
 * look is shown the same facts with no fields at all.
 *
 * Everything the contract lets a camera be set to is on this card, because a
 * setting with no screen is one nobody can undo: a grower who once turned
 * captures off during maintenance carried that preference through the migration
 * and had no way to find it, and the diary log of failed captures is off unless
 * somebody turns it on, which with no switch is never. The stale warning is the
 * one silence the alert inbox cannot be told to stop on its own, so its opt-out
 * belongs here beside the camera it is about.
 *
 * The two questions are asked apart because the routes ask them apart: the
 * fields are `manage` where the camera stands, which a co-manager of the tent
 * reaches, and taking the camera off the account is `own`, which nobody but its
 * owner ever reaches however much they may run the tent.
 */
export function CameraSettings({ camera, mayManage, mayOwn }: { camera: Camera; mayManage: boolean; mayOwn: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = useNow();
  const { user } = useSession();
  const devices = useDevices();
  const spaces = useSpaces();
  // Whether this install gates anything at all is the account's answer, not
  // the camera's: a camera's record carries its date on every install, and only
  // `/me` says whether the date means anything here. The demo has no account to
  // ask, so for it the camera's own record is all there is.
  const me = useMe(false, user?.isDemo !== true);
  const enforced = me.data ? me.data.premium.enforced : null;
  const ending = enforced ? countdownDays(camera, now) : null;
  const update = useUpdateCamera(camera.id);
  const remove = useRemoveCamera(camera.id);
  const [draft, setDraft] = useState<CameraUpdate>({});
  const [unpairing, setUnpairing] = useState(false);

  const value = <K extends keyof CameraUpdate>(key: K): CameraUpdate[K] =>
    key in draft ? draft[key] : (camera[key as keyof Camera] as CameraUpdate[K]);
  const set = <K extends keyof CameraUpdate>(key: K, next: CameraUpdate[K]) => setDraft(current => ({ ...current, [key]: next }));
  // The serialiser answers every one of these as a plain boolean, the stale
  // warning included, so a switch reads what it is given and decides nothing.
  const flag = (key: 'nightOff' | 'maintenanceOff' | 'logErrors' | 'staleWarning'): boolean => (key in draft ? draft[key] : camera[key]) === true;
  const changed = Object.keys(draft).length > 0;

  const place = spaces.data?.items.find(space => space.id === camera.spaceId)?.name ?? null;
  const through = devices.data?.items.find(device => device.id === camera.deviceId)?.name ?? null;

  const save = () =>
    update.mutate(draft, {
      onSuccess: () => setDraft({}),
    });

  return (
    <section className={styles.section}>
      <span className="label">{t('camera.thisCamera')}</span>

      <ul className={ui.group}>
        <Row label={t('camera.connectedVia')}>
          <span className={`mono ${styles.settingValue}`}>{[connection(t, camera, through), place].filter(Boolean).join(' · ')}</span>
        </Row>

        {/* Only where the answer carries it: the server keeps a camera's
            address for its owner and nulls every field of it for everybody
            else, so a co-manager or a guest is shown no row at all rather than
            a row of dashes. */}
        {reachedAt(t, camera) ? (
          <Row label={t('camera.reachedAt')}>
            <span className={styles.settingStack}>
              <span className={`mono ${styles.settingValue}`}>{reachedAt(t, camera)}</span>
              {camera.kind === 'rtsp' ? <span className={`${ui.note} ${styles.settingNote}`}>{t('camera.addressNote')}</span> : null}
            </span>
          </Row>
        ) : null}

        <Row label={t('camera.name')}>
          {mayManage ? (
            <input
              className={`${ui.input} ${styles.settingInput}`}
              value={(value('name') as string | undefined) ?? ''}
              onChange={event => set('name', event.target.value)}
              aria-label={t('camera.name')}
            />
          ) : (
            <span className={`mono ${styles.settingValue}`}>{camera.name}</span>
          )}
        </Row>

        <Row label={t('camera.looksAt')}>
          {mayManage ? (
            <input
              className={`${ui.input} ${styles.settingInput}`}
              value={(value('looksAt') as string | null) ?? ''}
              placeholder={t('camera.looksAtHint')}
              onChange={event => set('looksAt', event.target.value || null)}
              aria-label={t('camera.looksAt')}
            />
          ) : (
            <span className={`mono ${styles.settingValue}`}>{camera.looksAt ?? '—'}</span>
          )}
        </Row>

        <Row label={t('camera.premium')} help={enforced ? 'premiumCamera' : undefined}>
          <span className={styles.settingStack}>
            <span className={`mono ${styles.settingValue}`}>{entitlementLine(t, camera, enforced)}</span>
            {ending !== null ? (
              <span className={`mono ${styles.settingWarning}`} role="status">
                {ending === 0 ? t('me.premium.endsToday') : t('me.premium.endsIn', { count: ending })}
              </span>
            ) : null}
            {camera.entitlement.tier === 'free' ? (
              <span className={`${ui.note} ${styles.settingNote}`}>{t('camera.entitlement.freeLine')}</span>
            ) : null}
            <Link to="/me/premium" className={`mono ${styles.settingLink}`}>
              {t('camera.seePremium')} ›
            </Link>
          </span>
        </Row>

        <Row label={t('camera.stillEvery')} help="stillCadence">
          {mayManage ? (
            <span className={styles.interval}>
              <input
                className={`${ui.input} ${styles.number}`}
                type="number"
                min={30}
                step={10}
                value={(value('stillIntervalSeconds') as number | undefined) ?? camera.stillIntervalSeconds}
                onChange={event => set('stillIntervalSeconds', Number(event.target.value))}
                aria-label={t('camera.stillEvery')}
              />
              <span className="mono">s</span>
              <Check label={t('camera.nightOff')} on={flag('nightOff')} onChange={next => set('nightOff', next)} />
              <Check
                label={t('camera.maintenanceOff')}
                help="cameraPauses"
                on={flag('maintenanceOff')}
                onChange={next => set('maintenanceOff', next)}
              />
            </span>
          ) : (
            <span className={`mono ${styles.settingValue}`}>
              {[
                `${camera.stillIntervalSeconds} s`,
                camera.nightOff ? t('camera.nightOff') : null,
                camera.maintenanceOff ? t('camera.maintenanceOff') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </Row>

        <Row label={t('camera.tellsYou')} help="staleWarning">
          {mayManage ? (
            <span className={styles.interval}>
              <Check label={t('camera.staleWarning')} on={flag('staleWarning')} onChange={next => set('staleWarning', next)} />
              <Check label={t('camera.logErrors')} on={flag('logErrors')} onChange={next => set('logErrors', next)} />
            </span>
          ) : (
            <span className={`mono ${styles.settingValue}`}>
              {[camera.staleWarning ? t('camera.staleWarning') : null, camera.logErrors ? t('camera.logErrors') : null].filter(Boolean).join(' · ') ||
                t('camera.saysNothing')}
            </span>
          )}
        </Row>
      </ul>

      {update.error ? (
        <p className={ui.problem} role="alert">
          {refusalText(update.error, t('camera.saveFailed'))}
        </p>
      ) : null}

      {mayManage ? (
        <div className={styles.settingActions}>
          {/* Green is the one action a screen is offering; with nothing changed there is nothing to offer. */}
          <button type="button" className={`${ui.button} ${changed ? ui.primary : ''}`} disabled={!changed || update.isPending} onClick={save}>
            {update.isPending ? t('camera.saving') : t('camera.save')}
          </button>
          {!mayOwn ? null : unpairing ? (
            <>
              <span className={ui.note}>{t('camera.unpairSure')}</span>
              <button
                type="button"
                className={ui.button}
                disabled={remove.isPending}
                onClick={() => remove.mutate(undefined, { onSuccess: () => void navigate('/devices') })}
              >
                {t('camera.unpairYes')}
              </button>
              <button type="button" className={ui.button} onClick={() => setUnpairing(false)}>
                {t('camera.keep')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={`mono ${styles.unpair}`} onClick={() => setUnpairing(true)}>
                {t('camera.unpair')}
              </button>
              {camera.kind === 'terpcam_controller' ? <Help topic="unpair" /> : null}
            </>
          )}
        </div>
      ) : null}
      {mayOwn ? <p className={ui.note}>{t('camera.unpairNote')}</p> : null}
    </section>
  );
}

/** One of the camera's switches, labelled by what it does rather than by the field it writes. */
function Check({ label, help, on, onChange }: { label: string; help?: HelpTopic; on: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className={`mono ${styles.check}`}>
      {/* Named outright where the (i) stands in the label too, so the box is not called by the explanation's name as well. */}
      <input type="checkbox" checked={on} aria-label={help ? label : undefined} onChange={event => onChange(event.target.checked)} />
      {label}
      {help ? <Help topic={help} /> : null}
    </label>
  );
}

function Row({ label, help, children }: { label: string; help?: HelpTopic; children: React.ReactNode }) {
  return (
    <li className={`${ui.card} ${styles.setting}`}>
      <span className={styles.settingLabel}>
        {label}
        {help ? <Help topic={help} /> : null}
      </span>
      {children}
    </li>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Where the cloud reaches this camera: the stream it pulls and how, or the P2P
 * identity and address a Terp Cam answers on.
 *
 * It is stated and not offered as a field, although the contract would take a
 * new one. The URL is answered with its credentials stripped out - they are the
 * server's to keep - so a field prefilled with what was served would write the
 * stripped value back the first time somebody pressed Save, and the stream
 * would stop opening. Correcting an address that has moved wants a field that
 * starts empty and asks for the whole URL, which is what the add tab already
 * is; until there is one here, saying what the server is trying is worth far
 * more than saying nothing, because the failure this page reports a line above
 * is usually a failure to reach exactly this.
 */
const reachedAt = (t: Translate, camera: Camera): string | null => {
  const said =
    camera.kind === 'rtsp'
      ? [camera.url, camera.transport?.toUpperCase() ?? null, camera.tunnel ? t('camera.tunnelled') : null]
      : [camera.did, camera.ip, camera.model];

  return said.filter(Boolean).join(' · ') || null;
};

/** How the cloud reaches this camera, in the words the board uses for each kind. */
const connection = (t: Translate, camera: Camera, through: string | null): string => {
  if (camera.kind === 'terpcam_controller') return t('devices.via', { name: through ?? t('devices.type.controller') });

  return t(`devices.cameraKind.${camera.kind}`);
};

/**
 * Twelve months per camera, never renewed by this server, so the line says
 * which twelve and why.
 *
 * The tier is what decides the words, never the date: an install that gates
 * nothing answers `premium` for every camera whatever its record says, and
 * telling somebody their camera is not entitled while it renders in HD would be
 * the screen contradicting the server. Where the account has said the install
 * gates nothing, the date is not the news and is left out; where the server
 * calls a camera free, its date is the day the year ran out and is said as that.
 */
const entitlementLine = (t: Translate, camera: Camera, enforced: boolean | null): string => {
  const { validUntil, grant, tier } = camera.entitlement;
  if (enforced === false) return t('camera.entitlement.ungated');
  if (!validUntil) return t(tier === 'premium' ? 'camera.entitlement.ungated' : 'camera.entitlement.none');

  const date = DateTime.fromISO(validUntil).toFormat('d LLL yyyy');
  if (tier === 'free') return t('camera.entitlement.ranOut', { date });

  return t(`camera.entitlement.${grant ?? 'purchase'}`, { date });
};
