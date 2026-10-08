import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { Camera, CameraTransport, CameraUpdate, Device, RtspCameraCreate, Space, SpaceKind } from '@fg2/shared-types/v1';
import { CAPTURE_BUDGET_SECONDS } from '@fg2/shared-types/v1-schemas/capture.js';
import { useMe } from '@/api/account';
import { gaveUp, useCaptureOnce, useCreateCamera, useRemoveCamera, useUpdateCamera } from '@/api/cameras';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import type { Translate } from '@/i18n/i18n';
import { useCreateSpace, useSpaces } from '@/api/spaces';
import { deviceName } from '@/ui/naming';
import { ageAttribute, ageLabel, deviceLiveness } from '@/ui/age';
import { Help, Term } from '@/ui/Help';
import { LoadFailed, Refused, RefreshFailed, Waiting } from '@/ui/PageState';
import { enough } from '@/ui/session-access';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { carriersOf, hasLogin } from '../stream';
import { StreamFold, TransportRow, TunnelRow } from '../StreamOptions';
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
 * Where a Terp Control device stands in the place - a fridge module as much as
 * a controller - the stream is pulled through its tunnel, which is what makes
 * an address on a home network reachable at all; where none does, the cloud
 * opens the stream itself. Which device that is is said before the test rather
 * than found out after it, because a place may hold more than one and an
 * offline one is a stream that will not answer. Turning the tunnel off for a
 * camera the internet reaches, and how the stream is read, are under Erweitert.
 *
 * The login has fields of its own rather than being typed into the address:
 * the server writes it in, so a password with an `@` in it arrives intact. An
 * address pasted with a login already in it keeps that one.
 */
export function RtspCamera({ devices }: { devices: Device[] }) {
  const { t } = useTranslation();
  const now = useNow();
  const navigate = useNavigate();
  const me = useMe();
  const spaces = useSpaces();
  const create = useCreateCamera();
  const amend = useUpdateCamera();
  const capture = useCaptureOnce();
  const drop = useRemoveCamera();

  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [spaceId, setSpaceId] = useState<string | null>(null);
  /** Which of a place's devices carries the stream, where it holds more than one. */
  const [carrierId, setCarrierId] = useState<string | null>(null);
  /** Off only for a camera the internet reaches, which the cloud then opens itself. */
  const [tunnel, setTunnel] = useState(true);
  const [transport, setTransport] = useState<CameraTransport>('tcp');
  /** The camera once it exists, so a second test amends it rather than making another. */
  const [made, setMade] = useState<Camera | null>(null);

  if (spaces.isPending) return <Waiting lines={3} />;
  if (!spaces.data) return <LoadFailed retry={() => void spaces.refetch()} />;

  // Putting a camera somewhere is managing that place, so a tent this account
  // only writes lines in is not among the answers: offering it would end in a
  // refusal after the address and the name had already been typed.
  const places = spaces.data.items.filter(space => enough(space.youMay, 'manage'));
  // With one place there is nothing to choose: the camera looks at that one.
  const placeId = spaceId ?? (places.length === 1 ? places[0].id : null);

  const live = (device: Device) => deviceLiveness(device.state.lastSeenAt, now) === 'live';
  const carriers = placeId === null ? [] : carriersOf(devices, placeId, live);
  const carrier = carriers.find(device => device.id === carrierId) ?? carriers[0] ?? null;
  const pulled = carrier !== null && tunnel;

  // What is still missing, in the order the form asks for it, so that a button
  // which cannot be pressed says why instead of being grey for no stated
  // reason. Readiness is the absence of a reason rather than a second condition
  // beside it, because the two would drift apart the moment either changed.
  const missing = url.trim() === '' ? 'needAddress' : placeId === null ? 'needPlace' : name.trim() === '' ? 'needName' : null;
  const ready = missing === null;
  const working = create.isPending || amend.isPending || capture.isPending || drop.isPending;

  /** A different place is a different set of devices, so the one picked here does not follow. */
  const putIn = (id: string) => {
    setSpaceId(id);
    setCarrierId(null);
  };

  /** UDP does not pass through a tunnel, so turning it back on reads the stream over TCP again. */
  const pullThrough = (next: boolean) => {
    setTunnel(next);
    if (next && transport === 'udp') setTransport('tcp');
  };

  /**
   * The camera this form is about, made the first time it is needed and kept
   * afterwards. Everything is worked out again on every write, because the
   * place or the login may have been changed since the test that made it - an
   * emptied login field takes that half of the login away again.
   */
  const ensure = async (): Promise<Camera> => {
    const address = url.trim();
    const settings: CameraUpdate = {
      name: name.trim(),
      spaceId: placeId,
      url: address,
      ...(hasLogin(address) ? {} : { username: username.trim(), password }),
      deviceId: carrier?.id ?? null,
      tunnel: pulled,
      transport,
    };
    if (made) {
      const amended = await amend.mutateAsync({ cameraId: made.id, body: settings });
      setMade(amended);
      return amended;
    }

    const body: RtspCameraCreate = { kind: 'rtsp', ...settings, name: name.trim(), url: address };
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

  const shot = capture.data?.still ? mediaUrl(capture.data.still.mediaId, THUMBNAIL_WIDTH.frame) : null;
  const liveness = pulled && carrier ? deviceLiveness(carrier.state.lastSeenAt, now) : null;

  return (
    <>
      <RefreshFailed failedAt={spaces.isError ? spaces.dataUpdatedAt : null} now={now} />

      <section className={styles.block}>
        <header className={styles.blockHead}>
          <span className="label">
            <Term topic="rtsp">{t('cameras.add.rtsp.label')}</Term>
          </span>
        </header>
        <p className={styles.text}>{premiumLine(t, me.data?.premium)}</p>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <label className="label" htmlFor="rtsp-url">
            {t('cameras.add.rtsp.address')}
          </label>
          <Help topic="streamAddress" />
        </div>
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
        {hasLogin(url) ? (
          <p className={styles.text}>{t('cameras.add.rtsp.loginInAddress')}</p>
        ) : (
          <div className={styles.login}>
            <input
              className={ui.input}
              value={username}
              placeholder={t('cameras.add.rtsp.username')}
              aria-label={t('cameras.add.rtsp.username')}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              onChange={event => setUsername(event.target.value)}
            />
            <input
              className={ui.input}
              type="password"
              value={password}
              placeholder={t('cameras.add.rtsp.password')}
              aria-label={t('cameras.add.rtsp.password')}
              autoComplete="new-password"
              onChange={event => setPassword(event.target.value)}
            />
          </div>
        )}
        <p className={styles.text}>{wayIn(t, placeId, carrier, pulled)}</p>
        {carrier && liveness && liveness !== 'live' ? (
          <p className={styles.text} {...ageAttribute(liveness)}>
            {t(`cameras.add.rtsp.carrier.${liveness}`, {
              device: deviceName(carrier, t),
              age: ageLabel(carrier.state.lastSeenAt, now),
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
              <Choice key={space.id} chosen={space.id === placeId} onChoose={() => putIn(space.id)}>
                {space.name}
              </Choice>
            ))}
          </Choices>
        )}
      </section>

      {carriers.length > 1 ? (
        <section className={styles.block}>
          <span className="label">{t('camera.stream.throughWhich')}</span>
          <Choices label={t('camera.stream.throughWhich')}>
            {carriers.map(device => (
              <Choice key={device.id} chosen={device.id === carrier?.id} onChoose={() => setCarrierId(device.id)}>
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

      <StreamFold>
        {carrier ? <TunnelRow on={tunnel} carrier={carrier} onChange={pullThrough} /> : null}
        <TransportRow value={transport} tunnel={pulled} onChange={setTransport} />
      </StreamFold>

      {/* This side giving up on the answer is not the server refusing anything, so it is not drawn as a refusal. */}
      <Refused error={create.error ?? amend.error ?? (gaveUp(capture.error) ? null : capture.error) ?? drop.error} />

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

      {gaveUp(capture.error) ? (
        <p className={ui.problem} role="alert">
          {t('camera.testNoAnswer', { minutes: CAPTURE_BUDGET_SECONDS / 60 })}
        </p>
      ) : null}

      {capture.data ? (
        <section className={styles.block} role="status">
          {capture.data.still ? (
            <>
              {shot ? <img className={styles.shot} src={shot} alt={t('cameras.add.rtsp.shotAlt')} /> : null}
              <p className={`mono ${styles.shotNote}`}>{t('cameras.add.rtsp.worked', { age: ageLabel(capture.data.still.capturedAt, now) })}</p>
            </>
          ) : (
            <>
              <p className={ui.problem} role="alert">
                {t('cameras.add.rtsp.failed', { reason: t(`camera.failure.${capture.data.reason ?? 'unknown'}`) })}
              </p>
              {capture.data.error ? (
                <details className={styles.said}>
                  <summary className="mono">{t('camera.whatItSaid')}</summary>
                  <p className="mono">{capture.data.error}</p>
                </details>
              ) : null}
            </>
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

/** What the place the camera was put into is called, or nothing where the list no longer holds it. */
const placeOf = (spaces: Space[], spaceId: string | null): string | null => spaces.find(space => space.id === spaceId)?.name ?? null;

/**
 * How the cloud will reach this address, which is a fact about the place the
 * camera looks at rather than about the address: a place with a device in it
 * is reached through that device's tunnel, and one without is not reachable at
 * all unless the stream is already open to the internet - which is also what
 * turning the tunnel off under Erweitert says. Before a place is picked neither
 * is true yet, so the line says which question is still open instead of
 * promising a tunnel through a device nobody has named.
 */
const wayIn = (t: Translate, spaceId: string | null, carrier: Device | null, pulled: boolean): string => {
  if (spaceId === null) return t('cameras.add.rtsp.pickAPlace');
  if (carrier && pulled) return t('cameras.add.rtsp.throughDevice', { device: deviceName(carrier, t) });
  if (carrier) return t('cameras.add.rtsp.directByChoice');

  return t('cameras.add.rtsp.direct');
};

/** Where the camera now stands, named where the place is still known and left unnamed where it is not. */
const madeLine = (t: Translate, place: string | null): string =>
  place === null ? t('cameras.add.rtsp.madeSomewhere') : t('cameras.add.rtsp.made', { place });

/**
 * What Premium means for an RTSP camera. It works without it, gated like any
 * camera that has none, but no year of Premium comes with it: it is entitled by
 * purchase alone - except in an install that enforces nothing, where saying it
 * would be charged for would be untrue.
 */
const premiumLine = (t: Translate, premium: { enforced: boolean; priceLabel: string | null } | undefined): string => {
  if (premium && !premium.enforced) return t('cameras.add.rtsp.gatesNothing');
  if (premium?.priceLabel) return t('cameras.add.rtsp.premiumPriced', { price: premium.priceLabel });

  return t('cameras.add.rtsp.premium');
};
