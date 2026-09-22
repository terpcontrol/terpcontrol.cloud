import { Camera as CameraIcon, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Camera, Device, Space } from '@fg2/shared-types/v1';
import { useCameras, useCamerasAsOpened, useLatestStills, useUpdateCamera } from '@/api/cameras';
import { useDevices } from '@/api/devices';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { LoadFailed, Refused, RefreshFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import styles from './AddCamera.module.css';

/** The three things to do at the hardware, in the order they are done. */
const STEPS = ['one', 'two', 'three'] as const;

/**
 * Pairing the Terp Cam a controller answers for, which this screen does not do:
 * the knob on the controller does it, the controller reports the pairing over
 * MQTT, and the cloud makes the camera's row from that report. So the app's
 * part is to say what to turn and then to notice what arrives.
 *
 * What counts as arrived is a camera this account did not have when the screen
 * was opened, so the list is read twice: once and never again, which is the
 * line new is measured from, and on its beat, which is what crosses it. That
 * also makes the screen honest about a second cam paired while somebody is
 * still standing at the tent: it appears the same way the first one did.
 *
 * The watching is the ordinary camera read on its ordinary beat rather than a
 * loop of its own - the first still is about a minute away, so asking faster
 * would tell nobody anything sooner - and it stops when the screen is left,
 * because that is when the query has no reader left.
 */
export function PairTerpCam() {
  const { t } = useTranslation();
  const now = useNow();
  const cameras = useCameras();
  const opened = useCamerasAsOpened();
  const devices = useDevices();
  const spaces = useSpaces();

  const before = opened.data?.items;
  const found = before ? (cameras.data?.items ?? []).filter(one => !before.some(had => had.id === one.id)) : [];
  const stills = useLatestStills(found.map(one => one.id));

  if (cameras.isPending || opened.isPending) return <Waiting lines={3} />;
  if (!cameras.data || !opened.data) return <LoadFailed retry={() => void cameras.refetch()} />;

  return (
    <>
      <RefreshFailed failedAt={cameras.isError ? cameras.dataUpdatedAt : null} now={now} />

      <ol className={styles.steps}>
        {STEPS.map((step, index) => (
          <li key={step} className={styles.step}>
            <span className={styles.stepMark} aria-hidden>
              {index + 1}
            </span>
            <div>
              <p className={styles.stepTitle}>{t(`cameras.add.terpcam.${step}.title`)}</p>
              <p className={styles.stepText}>{t(`cameras.add.terpcam.${step}.text`)}</p>
            </div>
          </li>
        ))}
      </ol>

      {found.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`} role="status">
          {t('cameras.add.terpcam.watching')}
        </p>
      ) : (
        <ul className={styles.founds}>
          {found.map(camera => (
            <FoundCamera
              key={camera.id}
              camera={camera}
              devices={devices.data?.items ?? []}
              spaces={spaces.data?.items ?? []}
              stillId={stills.get(camera.id) ?? null}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * A camera that has turned up while somebody watched, and the two things step
 * three promises they can say about it. It is named rather than made here - the
 * row already exists, because the controller's report is what made it - so the
 * name the person gives replaces the one the pairing invented, which is the
 * controller's own.
 */
function FoundCamera({ camera, devices, spaces, stillId }: { camera: Camera; devices: Device[]; spaces: Space[]; stillId: string | null }) {
  const { t } = useTranslation();
  const rename = useUpdateCamera(camera.id);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(camera.name);
  const [looksAt, setLooksAt] = useState(camera.looksAt ?? '');
  /** What it has been called here, so the row stops naming the hardware once it has a name of its own. */
  const [called, setCalled] = useState<string | null>(null);

  const through = devices.find(device => device.id === camera.deviceId)?.name ?? null;
  const place = spaces.find(space => space.id === camera.spaceId)?.name ?? null;
  const source = stillId ? mediaUrl(stillId, THUMBNAIL_WIDTH.still) : null;

  const line = [
    camera.kind === 'terpcam_controller'
      ? t('devices.via', { name: through ?? t('devices.type.controller') })
      : t(`devices.cameraKind.${camera.kind}`),
    place,
  ]
    .filter(Boolean)
    .join(' · ');

  const save = () =>
    rename.mutate(
      { name: name.trim() || camera.name, looksAt: looksAt.trim() || null },
      {
        onSuccess: saved => {
          setCalled(saved.name);
          setNaming(false);
        },
      },
    );

  return (
    <li className={`${ui.card} ${styles.found}`}>
      <div className={styles.foundHead}>
        {source ? (
          <img className={styles.thumb} src={source} alt="" />
        ) : (
          <span className={styles.thumb} aria-hidden>
            <CameraIcon size={16} strokeWidth={1.75} />
          </span>
        )}
        <div className={styles.foundText}>
          <span className={styles.foundTitle}>
            <span className={styles.foundName}>{called ?? t('cameras.add.found.title', { tag: tagOf(camera) })}</span>
            <span className={styles.pill}>{t('cameras.add.found.pill')}</span>
          </span>
          <span className={styles.foundNote}>{line}</span>
        </div>
        {naming ? null : (
          <button type="button" className={`${ui.chip} ${styles.nameButton}`} onClick={() => setNaming(true)}>
            {t('cameras.add.found.name')}
            <ChevronRight size={14} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>

      {naming ? (
        <div className={styles.naming}>
          <label className="label" htmlFor={`name-${camera.id}`}>
            {t('cameras.add.found.nameLabel')}
          </label>
          <input
            id={`name-${camera.id}`}
            className={ui.input}
            value={name}
            autoFocus
            autoComplete="off"
            onChange={event => setName(event.target.value)}
          />

          <label className="label" htmlFor={`looks-at-${camera.id}`}>
            {t('cameras.add.found.looksAtLabel')}
          </label>
          <input
            id={`looks-at-${camera.id}`}
            className={ui.input}
            value={looksAt}
            placeholder={t('cameras.add.found.looksAtHint')}
            autoComplete="off"
            onChange={event => setLooksAt(event.target.value)}
          />

          <Refused error={rename.error} />

          <div className={styles.actions}>
            <button type="button" className={`${ui.button} ${ui.primary} ${styles.grow}`} disabled={rename.isPending} onClick={save}>
              {rename.isPending ? t('cameras.add.found.saving') : t('cameras.add.found.save')}
            </button>
            <button type="button" className={ui.button} onClick={() => setNaming(false)}>
              {t('cameras.add.cancel')}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The few characters printed on the cam, which is what it is called before
 * anybody has called it anything. A camera the cloud reached without a pairing
 * id falls back to its own, which is no worse a label and is never empty.
 */
const tagOf = (camera: Camera): string => (camera.did ?? camera.id).slice(-4).toUpperCase();
