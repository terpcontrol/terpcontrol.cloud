import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { CameraTransport, Device, RtspCameraCreate, Space, SpaceKind, StreamTestCreate } from '@fg2/shared-types/v1';
import { CAPTURE_BUDGET_SECONDS } from '@fg2/shared-types/v1-schemas/capture.js';
import { useMe } from '@/api/account';
import { gaveUp, useCreateCamera, useStreamTest } from '@/api/cameras';
import type { Translate } from '@/i18n/i18n';
import { useCreateSpace, useSpaces } from '@/api/spaces';
import { placesFor } from '@/app/places';
import { deviceName, PLACE_KINDS } from '@/ui/naming';
import { AdvancedFold } from '@/ui/advanced/AdvancedFold';
import { ageAttribute, ageLabel, deviceLiveness } from '@/ui/age';
import { Help, Term } from '@/ui/Help';
import { LoadFailed, Refused, RefreshFailed, Waiting } from '@/ui/PageState';
import { PlaceChoices } from '@/ui/PlaceChoices';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { beginsStreamAddress, carriersOf, hasLogin, isStreamAddress } from '../stream';
import { Raw } from '../Film';
import { TransportRow, TunnelRow } from '../StreamOptions';
import styles from './AddCamera.module.css';

/** Where the reason a button cannot be pressed is written, so both buttons can point a screen reader at it. */
const REASON = 'rtsp-missing';
/** Where an address that is none is refused, under its field, which the buttons then point at instead. */
const REFUSED = 'rtsp-refused';

/** The kinds of place a camera is hung in: every kind but the fridge nobody points one into. */
const CAMERA_PLACES = PLACE_KINDS.filter(kind => kind !== 'fridge');

/**
 * A camera of somebody else's making, reached at the address its stream is at.
 *
 * An address is `rtsp://` or `rtsps://` with a host, and anything else is
 * refused under the field before anything is written - as the server refuses
 * it: "quatsch" made a camera that could never show a picture. Whether the
 * address answers is found out by asking it for a picture, which is what the
 * test button does, and the test adds nothing: the server tries the address as
 * the camera would be read, in the place and through the device chosen, and
 * hands the picture back without storing it or making a camera. "Hinzufügen"
 * adds the camera, after a test or without one, and opens its page.
 *
 * Where a Terp Control device stands in the place - a fridge module as much as
 * a controller - the stream is pulled through its tunnel, which is what makes
 * an address on a home network reachable at all; where none does, the cloud
 * opens the stream itself - which the help beside the address explains and no
 * line under the field repeats. Under it stands only what will keep the stream
 * from answering, before the test rather than after it: a device that has gone
 * quiet, by name. Which device carries it is asked where a place holds more
 * than one. Turning the tunnel off for a camera the internet reaches, and how
 * the stream is read, are under Erweitert.
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
  const capture = useStreamTest();

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
  /** Which of the two buttons was pressed last, which says what the one write under way is for. */
  const [pressed, setPressed] = useState<'test' | 'add' | null>(null);

  if (spaces.isPending) return <Waiting lines={3} />;
  if (!spaces.data) return <LoadFailed retry={() => void spaces.refetch()} />;

  // Offering a place this account may not manage would end in a refusal after
  // the address and the name had already been typed.
  const places = placesFor(spaces.data.items);
  // With one place there is nothing to choose: the camera looks at that one.
  const placeId = spaceId ?? (places.length === 1 ? places[0].id : null);

  const live = (device: Device) => deviceLiveness(device.state.lastSeenAt, now) === 'live';
  const carriers = placeId === null ? [] : carriersOf(devices, placeId, live);
  const carrier = carriers.find(device => device.id === carrierId) ?? carriers[0] ?? null;
  const pulled = carrier !== null && tunnel;

  // What is still missing, in the order the form asks for it, so that a button
  // which cannot be pressed says why instead of being grey for no stated
  // reason. Readiness is the absence of a reason rather than a second condition
  // beside it, because the two would drift apart the moment either changed. An
  // address on its way to `rtsp://` is still being typed; one that cannot become
  // an address is refused. A test needs no name.
  const refused = !isStreamAddress(url) && !beginsStreamAddress(url);
  const forTest = refused ? 'badAddress' : !isStreamAddress(url) ? 'needAddress' : placeId === null ? 'needPlace' : null;
  const missing = forTest ?? (name.trim() === '' ? 'needName' : null);
  const working = create.isPending || capture.isPending;
  const reasonOf = (why: string | null) => (why === 'badAddress' ? REFUSED : why ? REASON : undefined);

  /** A different place is a different set of devices, so the one picked here does not follow. */
  const putIn = (id: string | null) => {
    setSpaceId(id);
    setCarrierId(null);
  };

  /** UDP does not pass through a tunnel, so turning it back on reads the stream over TCP again. */
  const pullThrough = (next: boolean) => {
    setTunnel(next);
    if (next && transport === 'udp') setTransport('tcp');
  };

  /** The stream as the form stands: the login apart from an address that carries none, the device worked out again. */
  const stream = (): Omit<StreamTestCreate, 'spaceId'> => {
    const address = url.trim();
    return {
      url: address,
      ...(hasLogin(address) ? {} : { username: username.trim(), password }),
      deviceId: carrier?.id ?? null,
      tunnel: pulled,
      transport,
    };
  };
  const body = (): RtspCameraCreate => ({ kind: 'rtsp', name: name.trim(), spaceId: placeId, ...stream() });

  // A refusal is drawn from the mutation that carries it, so nothing is done
  // with the rejection here beyond not letting it escape the handler.
  const test = () => {
    if (placeId === null) return;
    setPressed('test');
    void capture.mutateAsync({ spaceId: placeId, ...stream() }).catch(() => undefined);
  };

  const save = () => {
    setPressed('add');
    void create
      .mutateAsync(body())
      .then(camera => navigate(`/cameras/${camera.id}`))
      .catch(() => undefined);
  };

  const liveness = pulled && carrier ? deviceLiveness(carrier.state.lastSeenAt, now) : null;

  return (
    <>
      <RefreshFailed failedAt={spaces.isError ? spaces.dataUpdatedAt : null} now={now} />

      <section className={ui.stack2}>
        <header className={`${ui.row2} ${styles.blockHead}`}>
          <span className="label">
            <Term topic="rtsp">{t('cameras.add.rtsp.label')}</Term>
          </span>
        </header>
        <p className={styles.text}>{premiumLine(t, me.data?.premium)}</p>
      </section>

      <section className={ui.stack2}>
        <div className={`${ui.row2} ${styles.blockHead}`}>
          <label className="label" htmlFor="rtsp-url">
            {t('cameras.add.rtsp.address')}
          </label>
          <Help topic="streamAddress" />
        </div>
        <input
          id="rtsp-url"
          className={ui.input}
          value={url}
          placeholder={t('cameras.add.rtsp.placeholder')}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={refused || undefined}
          aria-describedby={refused ? REFUSED : undefined}
          onChange={event => {
            setUrl(event.target.value);
            // What a test said was said of the address it was asked of.
            capture.reset();
          }}
        />
        {refused ? (
          <p className={ui.problem} id={REFUSED}>
            {t('cameras.add.rtsp.badAddress')}
          </p>
        ) : null}
        {hasLogin(url) ? (
          <p className={styles.text}>{t('cameras.add.rtsp.loginInAddress')}</p>
        ) : (
          <div className={`${ui.halves} ${styles.login}`}>
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
        {/* The cloud opens the stream itself where no device stands to fetch it: said as the state of the place, not only behind the help. */}
        {placeId !== null && carriers.length === 0 ? (
          <p className={styles.text}>{t('cameras.add.rtsp.noCarrier', { place: places.find(space => space.id === placeId)?.name })}</p>
        ) : null}
        {carrier && liveness && liveness !== 'live' ? (
          <p className={styles.text} {...ageAttribute(liveness)}>
            {t(`cameras.add.rtsp.carrier.${liveness}`, {
              device: deviceName(carrier, t),
              age: ageLabel(carrier.state.lastSeenAt, now),
            })}
          </p>
        ) : null}
      </section>

      <section className={ui.stack2}>
        <span className="label">{t('cameras.add.rtsp.where')}</span>
        {places.length === 0 ? (
          <NewPlace onMade={space => putIn(space.id)} />
        ) : (
          <PlaceChoices label={t('cameras.add.rtsp.where')} places={places} chosen={placeId} onChoose={putIn} />
        )}
      </section>

      {carriers.length > 1 ? (
        <section className={ui.stack2}>
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

      <section className={ui.stack2}>
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

      <AdvancedFold>
        {carrier ? <TunnelRow on={tunnel} carrier={carrier} onChange={pullThrough} /> : null}
        <TransportRow value={transport} tunnel={pulled} onChange={setTransport} />
      </AdvancedFold>

      {/* This side giving up on the answer is not the server refusing anything, so it is not drawn as a refusal. */}
      <Refused error={create.error ?? (gaveUp(capture.error) ? null : capture.error)} />

      <p className={ui.note}>{t('cameras.add.rtsp.testOnly')}</p>

      {missing && missing !== 'badAddress' ? (
        <p className={ui.note} id={REASON}>
          {t(`cameras.add.rtsp.${missing}`)}
        </p>
      ) : null}

      <div className={`${ui.wrap} ${styles.actions}`}>
        <button type="button" className={ui.button} disabled={forTest !== null || working} aria-describedby={reasonOf(forTest)} onClick={test}>
          {working && pressed === 'test' ? t('cameras.add.rtsp.testing') : t('cameras.add.rtsp.test')}
        </button>
        <button
          type="button"
          className={`${ui.button} ${ui.primary} ${styles.grow}`}
          disabled={missing !== null || working}
          aria-describedby={reasonOf(missing)}
          onClick={save}
        >
          {working && pressed === 'add' ? t('cameras.add.rtsp.saving') : t('cameras.add.rtsp.save')}
        </button>
      </div>

      {gaveUp(capture.error) ? (
        <p className={ui.problem} role="alert">
          {t('camera.testNoAnswer', { minutes: CAPTURE_BUDGET_SECONDS / 60 })}
        </p>
      ) : null}

      {capture.data ? (
        <section className={ui.stack2} role="status">
          {capture.data.picture ? (
            <>
              <img className={styles.shot} src={`data:image/jpeg;base64,${capture.data.picture.jpeg}`} alt={t('cameras.add.rtsp.shotAlt')} />
              <p className={styles.shotNote}>{t('cameras.add.rtsp.worked', { age: ageLabel(capture.data.picture.capturedAt, now) })}</p>
            </>
          ) : (
            <>
              <p className={ui.problem} role="alert">
                {t('cameras.add.rtsp.failed', { reason: t(`camera.failure.${capture.data.reason ?? 'unknown'}`) })}
              </p>
              {capture.data.error ? <Raw summary={t('camera.whatItSaid')}>{capture.data.error}</Raw> : null}
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
export function NewPlace({ onMade, note }: { onMade: (space: Space) => void; note?: string }) {
  const { t } = useTranslation();
  const create = useCreateSpace();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SpaceKind>('tent');

  return (
    <section className={`${ui.cardDashed} ${ui.stack2}`}>
      <p className={ui.note}>{note ?? t('cameras.add.rtsp.nowhere')}</p>
      <input
        className={ui.input}
        value={name}
        placeholder={t('cameras.add.rtsp.placeName')}
        aria-label={t('cameras.add.rtsp.placeName')}
        autoComplete="off"
        onChange={event => setName(event.target.value)}
      />
      <Choices label={t('cameras.add.rtsp.placeKind')}>
        {CAMERA_PLACES.map(one => (
          <Choice key={one} chosen={kind === one} onChoose={() => setKind(one)}>
            {t(`place.edit.kind.${one}`)}
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
