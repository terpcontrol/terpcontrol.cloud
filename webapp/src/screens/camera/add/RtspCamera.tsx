import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { Camera, Device, RtspCameraCreate } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useAmendCamera, useCaptureOnce, useCreateCamera } from '@/api/cameras';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { ageAttribute, ageLabel, deviceLiveness } from '@/ui/age';
import { LoadFailed, Refused, RefreshFailed, Waiting } from '@/ui/PageState';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { controllerName, controllersOf } from './controllers';
import styles from './AddCamera.module.css';

/**
 * A camera of somebody else's making, reached at the address its stream is at.
 *
 * The server never refuses one: whether the address answers is found out by
 * asking it for a picture, which is what the test button does. That is also why
 * the camera is made by the first tap on either button rather than by Save
 * alone - a test capture is a camera's own route, so there has to be a camera
 * before there can be a test - and why nothing is lost by making it early: a
 * stream that never answered is a row on the Devices tab and is taken away
 * from the camera's own page like any other.
 *
 * Where a controller stands in the tent the stream is pulled through its
 * tunnel, which is what makes an address on a home network reachable at all;
 * where none does, the cloud opens the stream itself. Which controller that is
 * is said before the test rather than found out after it, because a tent may
 * hold more than one and an offline one is a stream that will not answer.
 */
export function RtspCamera({ devices }: { devices: Device[] }) {
  const { t } = useTranslation();
  const now = useNow();
  const navigate = useNavigate();
  const me = useMe();
  const spaces = useSpaces();
  const create = useCreateCamera();
  const amend = useAmendCamera();
  const capture = useCaptureOnce();

  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [spaceId, setSpaceId] = useState<string | null>(null);
  /** Which of a tent's controllers carries the stream, where it holds more than one. */
  const [carrierId, setCarrierId] = useState<string | null>(null);
  /** The camera once it exists, so a second test amends it rather than making another. */
  const [made, setMade] = useState<Camera | null>(null);

  if (spaces.isPending) return <Waiting lines={3} />;
  if (!spaces.data) return <LoadFailed retry={() => void spaces.refetch()} />;

  // Only a controller has a tunnel, so a fridge module standing in the tent is
  // not a way in and the stream has to be opened from the cloud instead.
  const carriers = spaceId === null ? [] : controllersOf(devices, spaceId);
  const controller = carriers.find(device => device.id === carrierId) ?? carriers[0] ?? null;

  const ready = url.trim().length > 0 && name.trim().length > 0 && spaceId !== null;
  const working = create.isPending || amend.isPending || capture.isPending;

  /** A different tent is a different set of controllers, so the one picked here does not follow. */
  const putIn = (id: string) => {
    setSpaceId(id);
    setCarrierId(null);
  };

  /**
   * The camera this form is about, made the first time it is needed and kept
   * afterwards. The tunnel is worked out again on every write, because the tent
   * may have been changed since the test that made the camera.
   */
  const ensure = async (): Promise<Camera> => {
    const settings = { name: name.trim(), spaceId, url: url.trim(), deviceId: controller?.id ?? null, tunnel: controller !== null };
    if (made) {
      const amended = await amend.mutateAsync({ cameraId: made.id, body: settings });
      setMade(amended);
      return amended;
    }

    const body: RtspCameraCreate = { kind: 'rtsp', ...settings };
    const fresh = await create.mutateAsync(body);
    setMade(fresh);
    return fresh;
  };

  // A refusal is drawn from the mutation that carries it, so nothing is done
  // with the rejection here beyond not letting it escape the handler.
  const test = () =>
    void ensure()
      .then(camera => capture.mutateAsync(camera.id))
      .catch(() => undefined);

  const save = () =>
    void ensure()
      .then(camera => navigate(`/cameras/${camera.id}`))
      .catch(() => undefined);

  const shot = capture.data?.mediaId ? mediaUrl(capture.data.mediaId, THUMBNAIL_WIDTH.frame) : null;
  const liveness = controller ? deviceLiveness(controller.state.lastSeenAt, now) : null;

  return (
    <>
      <RefreshFailed failedAt={spaces.isError ? spaces.dataUpdatedAt : null} now={now} />

      <section className={styles.block}>
        <header className={styles.blockHead}>
          <span className="label">{t('cameras.add.rtsp.label')}</span>
          <span className={styles.premium}>{t('devices.premium')}</span>
        </header>
        <p className={styles.text}>{premiumLine(t, me.data?.premium)}</p>
      </section>

      <section className={styles.block}>
        <label className="label" htmlFor="rtsp-url">
          {t('cameras.add.rtsp.address')}
        </label>
        <input
          id="rtsp-url"
          className={`mono ${ui.input}`}
          value={url}
          placeholder={t('cameras.add.rtsp.placeholder')}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          onChange={event => setUrl(event.target.value)}
        />
        <p className={styles.text}>{wayIn(t, spaceId, controller)}</p>
        {controller && liveness && liveness !== 'live' ? (
          <p className={styles.text} {...ageAttribute(liveness)}>
            {t(`cameras.add.rtsp.carrier.${liveness}`, {
              controller: controllerName(controller, t),
              age: ageLabel(controller.state.lastSeenAt, now),
            })}
          </p>
        ) : null}
      </section>

      <section className={styles.block}>
        <span className="label">{t('cameras.add.rtsp.where')}</span>
        {spaces.data.items.length === 0 ? (
          <p className={`${ui.cardDashed} ${ui.note}`}>{t('cameras.add.rtsp.nowhere')}</p>
        ) : (
          <Choices label={t('cameras.add.rtsp.where')}>
            {spaces.data.items.map(space => (
              <Choice key={space.id} chosen={space.id === spaceId} onChoose={() => putIn(space.id)}>
                {space.name}
              </Choice>
            ))}
          </Choices>
        )}
      </section>

      {carriers.length > 1 ? (
        <section className={styles.block}>
          <span className="label">{t('cameras.add.rtsp.throughWhich')}</span>
          <Choices label={t('cameras.add.rtsp.throughWhich')}>
            {carriers.map(device => (
              <Choice key={device.id} chosen={device.id === controller?.id} onChoose={() => setCarrierId(device.id)}>
                {controllerName(device, t)}
              </Choice>
            ))}
          </Choices>
        </section>
      ) : null}

      <section className={styles.block}>
        <label className="label" htmlFor="rtsp-name">
          {t('cameras.add.rtsp.name')}
        </label>
        <input
          id="rtsp-name"
          className={ui.input}
          value={name}
          placeholder={t('cameras.add.rtsp.nameHint')}
          autoComplete="off"
          onChange={event => setName(event.target.value)}
        />
      </section>

      <Refused error={create.error ?? amend.error ?? capture.error} />

      <div className={styles.actions}>
        <button type="button" className={ui.button} disabled={!ready || working} onClick={test}>
          {capture.isPending ? t('cameras.add.rtsp.testing') : t('cameras.add.rtsp.test')}
        </button>
        <button type="button" className={`${ui.button} ${ui.primary} ${styles.grow}`} disabled={!ready || working} onClick={save}>
          {create.isPending || amend.isPending ? t('cameras.add.rtsp.saving') : t('cameras.add.rtsp.save')}
        </button>
      </div>

      {capture.data ? (
        <section className={styles.block} role="status">
          {capture.data.succeeded ? (
            <>
              {shot ? <img className={styles.shot} src={shot} alt={t('cameras.add.rtsp.shotAlt')} /> : null}
              <p className={`mono ${styles.shotNote}`}>
                {t('cameras.add.rtsp.worked', { age: ageLabel(capture.data.capturedAt ?? now.toUTC().toISO()!, now) })}
              </p>
            </>
          ) : (
            <p className={ui.problem} role="alert">
              {t('cameras.add.rtsp.failed', { reason: capture.data.error ?? t('cameras.add.rtsp.noReason') })}
            </p>
          )}
        </section>
      ) : null}
    </>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * How the cloud will reach this address, which is a fact about the place the
 * camera looks at rather than about the address: a tent with a controller in it
 * is reached through that controller's tunnel, and one without is not reachable
 * at all unless the stream is already open to the internet. Before a place is
 * picked neither is true yet, so the line says which question is still open
 * instead of promising a tunnel through a controller nobody has named.
 */
const wayIn = (t: Translate, spaceId: string | null, controller: Device | null): string => {
  if (spaceId === null) return t('cameras.add.rtsp.pickAPlace');
  if (controller) return t('cameras.add.rtsp.throughController', { controller: controllerName(controller, t) });

  return t('cameras.add.rtsp.direct');
};

/**
 * What the Premium tag means here. An RTSP camera has no included year of its
 * own, so it is entitled by purchase alone - except in an install that enforces
 * nothing, where the tag is on the feature rather than on this camera and
 * saying it would be charged for would be untrue.
 */
const premiumLine = (t: Translate, premium: { enforced: boolean; priceLabel: string | null } | undefined): string => {
  if (premium && !premium.enforced) return t('cameras.add.rtsp.gatesNothing');
  if (premium?.priceLabel) return t('cameras.add.rtsp.premiumPriced', { price: premium.priceLabel });

  return t('cameras.add.rtsp.premium');
};
