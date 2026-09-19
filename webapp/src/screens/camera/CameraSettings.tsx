import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { Camera, CameraUpdate } from '@fg2/shared-types/v1';
import { useRemoveCamera, useUpdateCamera } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { ApiError } from '@/api/problem';
import { useSpaces } from '@/api/spaces';
import ui from '@/ui/ui.module.css';
import styles from './CameraPage.module.css';

/**
 * What the camera itself is set to: how it is reached, what it is pointed at,
 * how long its Premium runs and how often it takes a picture.
 *
 * How it is reached is what the camera *is* and is stated rather than offered:
 * a Terp Cam is paired at its controller and an RTSP camera is an address, and
 * neither is something this form turns into the other. Somebody who may only
 * look is shown the same facts with no fields at all.
 */
export function CameraSettings({ camera, mayManage }: { camera: Camera; mayManage: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const devices = useDevices();
  const spaces = useSpaces();
  const update = useUpdateCamera(camera.id);
  const remove = useRemoveCamera(camera.id);
  const [draft, setDraft] = useState<CameraUpdate>({});
  const [unpairing, setUnpairing] = useState(false);

  const value = <K extends keyof CameraUpdate>(key: K): CameraUpdate[K] =>
    key in draft ? draft[key] : (camera[key as keyof Camera] as CameraUpdate[K]);
  const set = <K extends keyof CameraUpdate>(key: K, next: CameraUpdate[K]) => setDraft(current => ({ ...current, [key]: next }));
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
          <span className={`mono ${styles.settingValue}`}>{entitlementLine(t, camera)}</span>
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
              <label className={`mono ${styles.check}`}>
                <input
                  type="checkbox"
                  checked={(value('nightOff') as boolean | undefined) ?? camera.nightOff}
                  onChange={event => set('nightOff', event.target.checked)}
                />
                {t('camera.nightOff')}
              </label>
            </span>
          ) : (
            <span className={`mono ${styles.settingValue}`}>
              {camera.stillIntervalSeconds} s{camera.nightOff ? ` · ${t('camera.nightOff')}` : ''}
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
          {unpairing ? (
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
      {mayManage ? <p className={ui.note}>{t('camera.unpairNote')}</p> : null}
    </section>
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
 * With no date, the tier is what decides the words: an install that gates
 * nothing answers `premium` for every camera, and telling somebody their camera
 * is not entitled while it renders in HD would be the screen contradicting the
 * server.
 */
const entitlementLine = (t: Translate, camera: Camera): string => {
  const { validUntil, grant, tier } = camera.entitlement;
  if (!validUntil) return t(tier === 'premium' ? 'camera.entitlement.ungated' : 'camera.entitlement.none');

  return t(`camera.entitlement.${grant ?? 'purchase'}`, { date: DateTime.fromISO(validUntil).toFormat('d LLL yyyy') });
};
