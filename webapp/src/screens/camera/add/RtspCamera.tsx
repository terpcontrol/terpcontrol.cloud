import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { Camera, Device, RtspCameraCreate, Space, SpaceKind } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useAmendCamera, useCaptureOnce, useCreateCamera, useDropCamera } from '@/api/cameras';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { deviceName } from '@/screens/devices/naming';
import { useCreateSpace } from '@/screens/grow/new/create-space';
import { ageAttribute, ageLabel, deviceLiveness } from '@/ui/age';
import { Term } from '@/ui/Help';
import { LoadFailed, Refused, RefreshFailed, Waiting } from '@/ui/PageState';
import { enough } from '@/ui/session-access';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { controllersOf } from './controllers';
import styles from './AddCamera.module.css';

/** Where the reason a button cannot be pressed is written, so both buttons can point a screen reader at it. */
const REASON = 'rtsp-missing';

/** The kinds of place a camera is hung in, which is every kind but the fridge nobody points one into. */
const PLACE_KINDS: SpaceKind[] = ['tent', 'room', 'balcony', 'other'];

/**
 * A camera of somebody else's making, reached at the address its stream is at.
 *
 * The server never refuses one: whether the address answers is found out by
 * asking it for a picture, which is what the test button does. That is also why
 * the camera is made by the first tap on either button rather than by Save
 * alone - a test capture is a camera's own route, so there has to be a camera
 * before there can be a test. Making it early is only honest if the screen says
 * so, so the test button says beforehand that it adds the camera, the screen
 * afterwards says where the camera now lives, the button that looked like the
 * commit stops claiming to be one, and taking it away again is offered here,
 * where a mistyped address is mistyped.
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
  const drop = useDropCamera();

  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [spaceId, setSpaceId] = useState<string | null>(null);
  /** Which of a tent's controllers carries the stream, where it holds more than one. */
  const [carrierId, setCarrierId] = useState<string | null>(null);
  /** The camera once it exists, so a second test amends it rather than making another. */
  const [made, setMade] = useState<Camera | null>(null);

  if (spaces.isPending) return <Waiting lines={3} />;
  if (!spaces.data) return <LoadFailed retry={() => void spaces.refetch()} />;

  // Putting a camera somewhere is managing that place, so a tent this account
  // only writes lines in is not among the answers: offering it would end in a
  // refusal after the address and the name had already been typed.
  const places = spaces.data.items.filter(space => enough(space.youMay, 'manage'));

  // Only a controller has a tunnel, so a fridge module standing in the tent is
  // not a way in and the stream has to be opened from the cloud instead.
  const carriers = spaceId === null ? [] : controllersOf(devices, spaceId);
  const controller = carriers.find(device => device.id === carrierId) ?? carriers[0] ?? null;

  // What is still missing, in the order the form asks for it, so that a button
  // which cannot be pressed says why instead of being grey for no stated
  // reason. Readiness is the absence of a reason rather than a second condition
  // beside it, because the two would drift apart the moment either changed.
  const missing = url.trim() === '' ? 'needAddress' : spaceId === null ? 'needPlace' : name.trim() === '' ? 'needName' : null;
  const ready = missing === null;
  const working = create.isPending || amend.isPending || capture.isPending || drop.isPending;

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

  /** The way back out of a mistyped address, from the screen the mistake was made on. */
  const remove = () => {
    if (made)
      drop.mutate(made.id, {
        onSuccess: () => {
          setMade(null);
          capture.reset();
        },
      });
  };

  const shot = capture.data?.mediaId ? mediaUrl(capture.data.mediaId, THUMBNAIL_WIDTH.frame) : null;
  const liveness = controller ? deviceLiveness(controller.state.lastSeenAt, now) : null;

  return (
    <>
      <RefreshFailed failedAt={spaces.isError ? spaces.dataUpdatedAt : null} now={now} />

      <section className={styles.block}>
        <header className={styles.blockHead}>
          <span className="label">
            <Term topic="rtsp">{t('cameras.add.rtsp.label')}</Term>
          </span>
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
              controller: deviceName(controller, t),
              age: ageLabel(controller.state.lastSeenAt, now),
            })}
          </p>
        ) : null}
      </section>

      <section className={styles.block}>
        <span className="label">{t('cameras.add.rtsp.where')}</span>
        {places.length === 0 ? (
          <NewPlace onMade={space => putIn(space.id)} />
        ) : (
          <Choices label={t('cameras.add.rtsp.where')}>
            {places.map(space => (
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
                {deviceName(device, t)}
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

      <Refused error={create.error ?? amend.error ?? capture.error ?? drop.error} />

      {made ? (
        <section className={styles.block} role="status">
          <p className={styles.text}>{madeLine(t, placeOf(spaces.data.items, made.spaceId))}</p>
          <button type="button" className={`${ui.button} ${styles.way}`} disabled={working} onClick={remove}>
            {drop.isPending ? t('cameras.add.rtsp.removing') : t('cameras.add.rtsp.remove')}
          </button>
        </section>
      ) : (
        <p className={ui.note}>{t('cameras.add.rtsp.testAdds')}</p>
      )}

      {missing ? (
        <p className={ui.note} id={REASON}>
          {t(`cameras.add.rtsp.${missing}`)}
        </p>
      ) : null}

      <div className={styles.actions}>
        <button type="button" className={ui.button} disabled={!ready || working} aria-describedby={missing ? REASON : undefined} onClick={test}>
          {capture.isPending ? t('cameras.add.rtsp.testing') : t('cameras.add.rtsp.test')}
        </button>
        <button
          type="button"
          className={`${ui.button} ${ui.primary} ${styles.grow}`}
          disabled={!ready || working}
          aria-describedby={missing ? REASON : undefined}
          onClick={save}
        >
          {create.isPending || amend.isPending ? t('cameras.add.rtsp.saving') : made ? t('cameras.add.rtsp.open') : t('cameras.add.rtsp.save')}
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

/**
 * The place this camera looks at, made here because there is none.
 *
 * This is the one door into the app for a grower who bought a stream camera
 * before any hardware, and a place can otherwise only be invented by claiming a
 * device or by starting a grow - neither of which is what somebody standing on
 * this tab came to do. So the note that names the missing thing carries the
 * control that supplies it, as the Terp Cam tab's does, and the place it makes
 * becomes the chosen one without the address and the name already typed being
 * lost.
 */
function NewPlace({ onMade }: { onMade: (space: Space) => void }) {
  const { t } = useTranslation();
  const create = useCreateSpace();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SpaceKind>('tent');

  return (
    <section className={`${ui.cardDashed} ${styles.block}`}>
      <p className={ui.note}>{t('cameras.add.rtsp.nowhere')}</p>
      <input
        className={ui.input}
        value={name}
        placeholder={t('cameras.add.rtsp.placeName')}
        aria-label={t('cameras.add.rtsp.placeName')}
        autoComplete="off"
        onChange={event => setName(event.target.value)}
      />
      <Choices label={t('cameras.add.rtsp.placeKind')}>
        {PLACE_KINDS.map(one => (
          <Choice key={one} chosen={kind === one} onChoose={() => setKind(one)}>
            {t(`cameras.add.rtsp.kind.${one}`)}
          </Choice>
        ))}
      </Choices>
      <Refused error={create.error} />
      <button
        type="button"
        className={`${ui.button} ${styles.way}`}
        disabled={create.isPending || name.trim() === ''}
        onClick={() => create.mutate({ kind, name: name.trim() }, { onSuccess: onMade })}
      >
        {create.isPending ? t('cameras.add.rtsp.makingPlace') : t('cameras.add.rtsp.makePlace')}
      </button>
    </section>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** What the place the camera was put into is called, or nothing where the list no longer holds it. */
const placeOf = (spaces: Space[], spaceId: string | null): string | null => spaces.find(space => space.id === spaceId)?.name ?? null;

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
  if (controller) return t('cameras.add.rtsp.throughController', { controller: deviceName(controller, t) });

  return t('cameras.add.rtsp.direct');
};

/** Where the camera now stands, named where the place is still known and left unnamed where it is not. */
const madeLine = (t: Translate, place: string | null): string =>
  place === null ? t('cameras.add.rtsp.madeSomewhere') : t('cameras.add.rtsp.made', { place });

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
