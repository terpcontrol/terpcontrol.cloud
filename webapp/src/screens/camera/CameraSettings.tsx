import { useState } from 'react';
import { useAccountMe } from '@/api/account';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { Camera, CameraUpdate } from '@fg2/shared-types/v1';
import { useRemoveCamera, useUpdateCamera } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { useDiaryLayer } from '@/api/layers';
import { useSpaces } from '@/api/spaces';
import { controlPath } from '@/app/places';
import type { Translate } from '@/i18n/i18n';
import type { Told } from '@/log/log-context';
import { deviceName } from '@/ui/naming';
import { countdownDays } from '@/screens/me/premium/entitlement';
import { missingLine } from '@/screens/me/premium/free-tier';
import { AdvancedSection } from '@/ui/advanced/Advanced';
import { Asking } from '@/ui/Asking';
import type { HelpTopic } from '@/ui/explain';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { calendarDay, zoneOf } from '@/ui/zone';
import styles from './CameraPage.module.css';

/** What a save says it changed, by the field it wrote. */
const SAID: Partial<Record<keyof CameraUpdate, string>> = {
  name: 'camera.name',
  looksAt: 'camera.looksAt',
  stillIntervalSeconds: 'camera.stillEvery',
  nightOff: 'camera.nightOff',
  maintenanceOff: 'camera.maintenanceOff',
  staleWarning: 'camera.staleWarning',
  logErrors: 'camera.logErrors',
  url: 'camera.address',
  username: 'camera.address',
  password: 'camera.address',
};

/** What a save cannot put back: the login is never served, so the one before it is not known here. */
const KEPT_BY_SERVER: readonly (keyof CameraUpdate)[] = ['url', 'username', 'password'];

/**
 * What the camera itself is set to, behind the page's last row: how it is
 * reached, what it is pointed at, when it takes a picture, what it says when
 * it stops, how long its Premium runs - and, for its owner, the way to take
 * it off the account. Everything the contract lets a camera be set to is
 * here, because a setting with no screen is one nobody can undo.
 *
 * How it is reached is what the camera *is* and is stated rather than
 * offered; a stream's address can be corrected, and how it is pulled is under
 * Erweitert. Somebody who may only look reads the same facts with no fields.
 * One Save writes what was changed and the toast names it, with the way back
 * where the server can put it back; closing with something unsaved asks
 * first. The fields are `manage` where the camera stands, taking it off the
 * account is `own`, as the routes ask them.
 */
export function CameraSettings({
  camera,
  mayManage,
  mayOwn,
  tell,
  onClose,
}: {
  camera: Camera;
  mayManage: boolean;
  mayOwn: boolean;
  /** Says what a save or the unpairing did once the sheet is gone: the app's toast. */
  tell: (told: Told) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = useNow();
  const diary = useDiaryLayer();
  const devices = useDevices();
  const spaces = useSpaces();
  // Whether this install gates anything at all is the account's answer, not
  // the camera's; the demo has no account to ask, so for it the camera's own
  // record is all there is.
  const me = useAccountMe();
  const enforced = me.data ? me.data.premium.enforced : null;
  const ending = enforced ? countdownDays(camera, now) : null;
  const update = useUpdateCamera();
  const remove = useRemoveCamera();
  const [draft, setDraft] = useState<CameraUpdate>({});
  const [asking, setAsking] = useState<'unpair' | 'leave' | null>(null);
  const [readdressing, setReaddressing] = useState(false);
  const editing = camera.kind === 'rtsp' && mayManage && readdressing;
  // Leaving it out when the light goes off or the tent is worked in is a device's to decide: without one, neither switch does anything.
  const steered = camera.deviceId !== null;

  const value = <K extends keyof CameraUpdate>(key: K): CameraUpdate[K] =>
    key in draft ? draft[key] : (camera[key as keyof Camera] as CameraUpdate[K]);
  /** Nothing typed is no change, so an emptied field leaves the draft rather than standing in it as one. */
  const set = <K extends keyof CameraUpdate>(key: K, next: CameraUpdate[K]) =>
    setDraft(current => {
      const rest = { ...current };
      delete rest[key];
      return next === undefined ? rest : { ...rest, [key]: next };
    });
  const keepAddress = () => {
    for (const key of KEPT_BY_SERVER) set(key, undefined);
    setReaddressing(false);
  };
  const flag = (key: 'nightOff' | 'maintenanceOff' | 'logErrors' | 'staleWarning'): boolean => (key in draft ? draft[key] : camera[key]) === true;
  const changed = Object.keys(draft).length > 0;

  const place = spaces.data?.items.find(space => space.id === camera.spaceId)?.name ?? null;
  // The carrier by the name every other screen gives it, never the type key a claim stored as one.
  const carrier = devices.data?.items.find(device => device.id === camera.deviceId) ?? null;
  const through = carrier ? deviceName(carrier, t) : null;
  // What a stream can be pulled through: what stands where the camera looks, and the device it already names.
  const here = (devices.data?.items ?? []).filter(device => device.spaceId === camera.spaceId || device.id === camera.deviceId);

  const save = () => {
    const keys = Object.keys(draft) as (keyof CameraUpdate)[];
    const before = Object.fromEntries(keys.map(key => [key, camera[key as keyof Camera]])) as CameraUpdate;
    update.mutate(
      { cameraId: camera.id, body: draft },
      {
        onSuccess: () => {
          const what = [...new Set(keys.flatMap(key => SAID[key] ?? []))].map(key => t(key)).join(', ');
          tell({
            label: t('camera.saved', { what }),
            undo: keys.some(key => KEPT_BY_SERVER.includes(key)) ? null : () => update.mutateAsync({ cameraId: camera.id, body: before }),
          });
          onClose();
        },
      },
    );
  };
  const unpair = () =>
    remove.mutate(camera.id, {
      onSuccess: () => {
        tell({ label: t('camera.unpaired', { name: camera.name }), undo: null });
        void navigate(camera.spaceId ? controlPath(camera.spaceId) : '/');
      },
    });

  return (
    <Sheet
      title={t(mayManage ? 'camera.settings' : 'camera.about')}
      onClose={() => (changed ? setAsking('leave') : onClose())}
      actions={
        asking === 'leave' ? (
          <Asking note={t('camera.leaveUnsaved')} yes={t('camera.discard')} danger busy={false} onYes={onClose} onCancel={() => setAsking(null)} />
        ) : mayManage ? (
          <>
            <Refused error={update.error} fallback={t('camera.saveFailed')} />
            <button type="button" className={`${ui.button} ${changed ? ui.primary : ''}`} disabled={!changed || update.isPending} onClick={save}>
              {update.isPending ? t('camera.saving') : t('camera.save')}
            </button>
          </>
        ) : undefined
      }
    >
      <div className={styles.sheet}>
        <ul className={ui.group}>
          <Row label={t('camera.connectedVia')}>
            <span className={`mono ${styles.settingValue}`}>
              {[connection(t, camera, through), place === through ? null : place].filter(Boolean).join(' · ')}
            </span>
          </Row>

          {/* Only where the answer carries it: the server keeps a camera's address for its owner and nulls it for everybody else. */}
          {reachedAt(camera) ? (
            <Row
              label={t(camera.kind === 'rtsp' ? 'camera.address' : 'camera.reachedAt')}
              help={camera.kind === 'rtsp' ? 'streamAddress' : undefined}
            >
              <span className={styles.settingStack} data-editing={editing || undefined}>
                {/* A stream's address is the one thing a router changes under it, so it is changed here rather than by
                    unpairing. The login is never served, so its two fields start empty and an empty one keeps it. */}
                {editing ? (
                  <>
                    <input
                      className={`mono ${ui.input} ${styles.settingInput}`}
                      value={(value('url') as string | undefined) ?? camera.url ?? ''}
                      onChange={event => set('url', event.target.value)}
                      aria-label={t('camera.address')}
                      autoCapitalize="none"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <span className={styles.login}>
                      <input
                        className={`${ui.input} ${styles.settingInput}`}
                        value={draft.username ?? ''}
                        placeholder={t('camera.username')}
                        onChange={event => set('username', event.target.value || undefined)}
                        aria-label={t('camera.username')}
                        autoCapitalize="none"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <input
                        className={`${ui.input} ${styles.settingInput}`}
                        type="password"
                        value={draft.password ?? ''}
                        placeholder={t('camera.password')}
                        onChange={event => set('password', event.target.value || undefined)}
                        aria-label={t('camera.password')}
                        autoComplete="new-password"
                      />
                    </span>
                  </>
                ) : (
                  <span className={`mono ${styles.settingValue}`}>{reachedAt(camera)}</span>
                )}
                {camera.kind === 'rtsp' ? (
                  <span className={`${ui.note} ${styles.settingNote}`}>{t(readdressing ? 'camera.addressChangeNote' : 'camera.addressNote')}</span>
                ) : null}
                {camera.kind === 'rtsp' && mayManage ? (
                  <button type="button" className={`mono ${styles.textLink}`} onClick={readdressing ? keepAddress : () => setReaddressing(true)}>
                    {t(readdressing ? 'camera.keepAddress' : 'camera.changeAddress')} ›
                  </button>
                ) : null}
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
                {steered ? (
                  <>
                    <Check label={t('camera.nightOff')} on={flag('nightOff')} onChange={next => set('nightOff', next)} />
                    <Check
                      label={t('camera.maintenanceOff')}
                      help="cameraPauses"
                      on={flag('maintenanceOff')}
                      onChange={next => set('maintenanceOff', next)}
                    />
                  </>
                ) : null}
              </span>
            ) : (
              <span className={`mono ${styles.settingValue}`}>
                {[
                  `${camera.stillIntervalSeconds} s`,
                  steered && camera.nightOff ? t('camera.nightOff') : null,
                  steered && camera.maintenanceOff ? t('camera.maintenanceOff') : null,
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
                {/* A diary line is offered only to somebody who keeps a diary, or who already asked for one. */}
                {diary || flag('logErrors') ? (
                  <Check label={t('camera.logErrors')} on={flag('logErrors')} onChange={next => set('logErrors', next)} />
                ) : null}
              </span>
            ) : (
              <span className={`mono ${styles.settingValue}`}>
                {[camera.staleWarning ? t('camera.staleWarning') : null, camera.logErrors ? t('camera.logErrors') : null]
                  .filter(Boolean)
                  .join(' · ') || t('camera.saysNothing')}
              </span>
            )}
          </Row>

          <Row label={t('camera.premium')} help={enforced ? 'premiumCamera' : undefined}>
            <span className={styles.settingStack}>
              <span className={`mono ${styles.settingValue}`}>{entitlementLine(t, camera, enforced, zoneOf(me.data))}</span>
              {ending !== null ? (
                <span className={`mono ${styles.settingWarning}`} role="status">
                  {ending === 0 ? t('me.premium.endsToday') : t('me.premium.endsIn', { count: ending })}
                </span>
              ) : null}
              {camera.entitlement.tier === 'free' && me.data ? (
                <span className={`${ui.note} ${styles.settingNote}`}>
                  {t('camera.entitlement.freeLine', { missing: missingLine(t, me.data.premium.free) })}
                </span>
              ) : null}
              <Link to="/me/premium" className={`mono ${styles.textLink}`}>
                {t('camera.seePremium')} ›
              </Link>
            </span>
          </Row>
        </ul>

        <AdvancedSection scope="camera" context={{ camera, devices: here, mayManage }} />

        {/* Taking the camera off the account is the owner's alone, asked where it stands, and cannot be taken back. */}
        {!mayOwn ? null : asking === 'unpair' ? (
          <Asking
            note={`${t('camera.unpairNote')} ${t('camera.unpairSure')}`}
            yes={t('camera.unpairYes')}
            danger
            busy={remove.isPending}
            onYes={unpair}
            onCancel={() => setAsking(null)}
          />
        ) : (
          <span className={styles.unpair}>
            <button type="button" className={`${ui.button} ${ui.dangerOutline}`} onClick={() => setAsking('unpair')}>
              {t('camera.unpair')}
            </button>
            {camera.kind === 'terpcam_controller' ? <Help topic="unpair" /> : null}
          </span>
        )}
        <Refused error={remove.error} />
      </div>
    </Sheet>
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

/**
 * Where the cloud reaches this camera - what the server is trying, since a
 * failure is usually a failure to reach exactly this: the stream it pulls
 * (its login stripped out, which is the server's to keep) and how where that
 * is not TCP, or the P2P identity and address a Terp Cam answers on.
 */
const reachedAt = (camera: Camera): string | null => {
  const said =
    camera.kind === 'rtsp'
      ? [camera.url, camera.transport && camera.transport !== 'tcp' ? camera.transport.toUpperCase() : null]
      : // The model is the firmware's code for it; the Terp Cam's is what the screen already calls it.
        [camera.did, camera.ip, camera.model === 'terp_cam' ? null : camera.model];

  return said.filter(Boolean).join(' · ') || null;
};

/** How the cloud reaches this camera, under a label that already says "via". */
const connection = (t: Translate, camera: Camera, through: string | null): string => {
  if (camera.kind === 'terpcam_controller') return through ?? t('camera.kind.terpcam_controller');
  if (camera.kind === 'rtsp') {
    if (!camera.tunnel) return t('camera.rtspDirect');
    return through ? t('camera.rtspThrough', { device: through }) : t('camera.rtspTunnelled');
  }

  return t(`camera.kind.${camera.kind}`);
};

/**
 * Twelve months per camera, never renewed by this server, so the line says
 * which twelve and why. The tier decides the words, never the date: an
 * install that gates nothing answers `premium` whatever a camera's record
 * says, and a free camera's date is the day its year ran out.
 */
const entitlementLine = (t: Translate, camera: Camera, enforced: boolean | null, zone: string | null): string => {
  const { validUntil, grant, tier } = camera.entitlement;
  if (enforced === false) return t('camera.entitlement.ungated');
  if (!validUntil) return t(tier === 'premium' ? 'camera.entitlement.ungated' : 'camera.entitlement.none');

  const date = calendarDay(validUntil, zone);
  if (tier === 'free') return t('camera.entitlement.ranOut', { date });

  return t(`camera.entitlement.${grant ?? 'purchase'}`, { date });
};
