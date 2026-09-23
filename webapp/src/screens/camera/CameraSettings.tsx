import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { Camera, CameraUpdate } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useRemoveCamera, useUpdateCamera } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { ApiError } from '@/api/problem';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { countdownDays } from '@/screens/me/premium/entitlement';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import styles from './CameraPage.module.css';

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

      <ul className={styles.settings}>
        <Row label={t('camera.connectedVia')}>
          <span className={`mono ${styles.settingValue}`}>{[connection(t, camera, through), place].filter(Boolean).join(' · ')}</span>
        </Row>

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

        <Row label={t('camera.premium')}>
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

        <Row label={t('camera.stillEvery')}>
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
              <Check label={t('camera.maintenanceOff')} on={flag('maintenanceOff')} onChange={next => set('maintenanceOff', next)} />
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

        <Row label={t('camera.tellsYou')}>
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
          {update.error instanceof ApiError ? update.error.problem.detail || update.error.problem.title : t('camera.saveFailed')}
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
            <button type="button" className={`mono ${styles.unpair}`} onClick={() => setUnpairing(true)}>
              {t('camera.unpair')}
            </button>
          )}
        </div>
      ) : null}
      {mayOwn ? <p className={ui.note}>{t('camera.unpairNote')}</p> : null}
    </section>
  );
}

/** One of the camera's switches, labelled by what it does rather than by the field it writes. */
function Check({ label, on, onChange }: { label: string; on: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className={`mono ${styles.check}`}>
      <input type="checkbox" checked={on} onChange={event => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className={`${ui.card} ${styles.setting}`}>
      <span className={styles.settingLabel}>{label}</span>
      {children}
    </li>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

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
