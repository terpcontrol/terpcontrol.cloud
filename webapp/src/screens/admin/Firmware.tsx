import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceClass, Firmware, Fleet } from '@fg2/shared-types/v1';
import {
  useAdminDevices,
  useCreateFirmware,
  useDeleteFirmware,
  useDeviceClasses,
  useFirmwares,
  useFleet,
  useUpdateFirmware,
  useUploadBinary,
} from '@/api/admin';
import { itemsOf, useFollowCursor } from '@/api/pages';
import { Facts } from '@/ui/Facts';
import { NameSheet } from '@/ui/NameSheet';
import { Sheet } from '@/ui/Sheet';
import { typeName } from '@/ui/naming';
import { together } from '@/api/read';
import { NothingHere, Refused } from '@/ui/PageState';
import { AdminHead, AdminNotLoaded, Label, OutOfTheRow } from './parts';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { CLOCK, useZone, zoned } from '@/ui/zone';
import { ClassRollout } from './ClassRollout';
import { pointedAtBy } from './rollout';
import styles from './Admin.module.css';
import { Answer } from '@/ui/Asking';

/**
 * The builds this cloud hands out, and where each class is handing them.
 *
 * Two halves, in the order they are used: the classes, where a channel is
 * pointed at a build and the rollout is staged, and the builds themselves,
 * which are registered, given their files, relabelled and deleted. A build is
 * registered before it has any bytes, because a file is uploaded against it by
 * the name the device asks for it under, and a build is several of them.
 *
 * A build's version is the uuid its build container stamped it with. Nothing on
 * this screen sorts or ranks by it: the list is in the order the server gave,
 * which is by the instant each was registered, and "the newer build" is a thing
 * only that instant can say.
 */
export function FirmwareScreen() {
  const { t } = useTranslation();
  const now = useNow();

  const fleet = useFleet();
  const classes = useDeviceClasses();
  const firmwares = useFirmwares(null);
  const devices = useAdminDevices();

  useFollowCursor(firmwares);
  useFollowCursor(devices);

  const header = <AdminHead title={t('admin.firmware.title')} readAt={firmwares.dataUpdatedAt} />;

  if (classes.isPending || firmwares.isPending) return <AdminNotLoaded head={header} />;

  if (!classes.data || !firmwares.data) return <AdminNotLoaded head={header} read={together(classes, firmwares)} />;

  const builds = itemsOf(firmwares.data);
  const allDevices = itemsOf(devices.data);
  const known = classes.data.items;

  return (
    <section className={ui.stack4}>
      {header}

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <Label text={t('admin.firmware.classes')} help="firmwareClasses" />
        </div>
        {known.map(deviceClass => (
          <ClassRollout
            key={deviceClass.id}
            deviceClass={deviceClass}
            fleetClass={fleet.data?.classes.find(one => one.classId === deviceClass.id)}
            devices={allDevices}
            firmwares={builds}
            now={now}
          />
        ))}
      </section>

      <Register classes={known} />

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('admin.firmware.column.build')}</th>
              <th>{t('admin.firmware.column.class')}</th>
              <th>{t('admin.firmware.column.registered')}</th>
              <th>{t('admin.firmware.column.channels')}</th>
              <th>{t('admin.firmware.column.running')}</th>
              <th>{t('admin.firmware.column.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {builds.map(build => (
              <BuildRow key={build.id} build={build} classes={known} fleet={fleet.data} />
            ))}
          </tbody>
        </table>
      </div>

      {builds.length === 0 ? <NothingHere>{t('admin.firmware.noBuilds')}</NothingHere> : null}
    </section>
  );
}

/** Registering a build: the row a file is then uploaded against. The version is what the build container stamped, so it is typed in rather than invented here. */
function Register({ classes }: { classes: DeviceClass[] }) {
  const { t } = useTranslation();
  const create = useCreateFirmware();
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');

  const ready = classId !== '' && version.trim() !== '';

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <Label text={t('admin.firmware.register')} help="firmwareRegister" />
      </div>

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className="label">{t('admin.firmware.column.class')}</span>
          <select className={`${ui.input} ${ui.menu}`} value={classId} onChange={event => setClassId(event.target.value)}>
            {classes.map(deviceClass => (
              <option key={deviceClass.id} value={deviceClass.id}>
                {typeName(deviceClass.name, t)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className="label">{t('admin.firmware.buildName')}</span>
          <input className={ui.input} value={name} autoComplete="off" onChange={event => setName(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span className="label">{t('admin.firmware.version')}</span>
          <input className={ui.input} value={version} autoComplete="off" onChange={event => setVersion(event.target.value)} />
        </label>
      </div>

      <div className={ui.wrapRow}>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={!ready || create.isPending}
          onClick={() =>
            create.mutate(
              { classId, name: name.trim() || null, version: version.trim() },
              {
                onSuccess: () => {
                  setName('');
                  setVersion('');
                },
              },
            )
          }
        >
          {t('admin.firmware.registerIt')}
        </button>
      </div>
      <Refused error={create.error} />
    </section>
  );
}

function BuildRow({ build, classes, fleet }: { build: Firmware; classes: DeviceClass[]; fleet: Fleet | undefined }) {
  const { t } = useTranslation();
  const zone = useZone();
  const [open, setOpen] = useState<'upload' | 'rename' | 'delete' | null>(null);

  const pointers = pointedAtBy(build.id, classes);
  const stats = fleet?.classes.find(one => one.classId === build.classId)?.firmwares.find(one => one.firmwareId === build.id);
  const deviceClass = classes.find(one => one.id === build.classId);

  return (
    <tr>
      <td className={styles.idCell}>
        {build.name ? <span>{build.name}</span> : <span className={styles.rowName}>{t('admin.firmware.unnamed')}</span>}
        <div className="mono">{build.version}</div>
      </td>
      <td>{deviceClass ? typeName(deviceClass.name, t) : <span className="mono">{build.classId}</span>}</td>
      <td className="mono">{zoned(build.createdAt, zone).toFormat(`yyyy-LL-dd ${CLOCK}`)}</td>
      {/* Facts that break between them rather than one line the pinned actions cut: "21 auf…" said nothing. */}
      <td>
        {pointers.length > 0 || build.wasStable ? (
          <Facts
            facts={[
              ...pointers.map(one => `${typeName(one.deviceClass.name, t)} · ${t(`devices.channel.${one.channel}`)}`),
              build.wasStable ? t('admin.firmware.wasStable') : null,
            ]}
          />
        ) : (
          '—'
        )}
      </td>
      <td className={styles.counts}>
        {stats ? (
          <Facts
            facts={[
              String(stats.total),
              t('admin.count.online', { count: stats.online }),
              t('admin.count.installing', { count: stats.updating }),
              t('admin.firmware.gaveUp', { count: stats.failed }),
            ]}
          />
        ) : (
          '—'
        )}
      </td>
      <td>
        <span className={`${ui.wrap} ${styles.actions}`}>
          <button type="button" className={ui.chip} onClick={() => setOpen('upload')}>
            {t('admin.firmware.upload')}
          </button>
          <button type="button" className={ui.chip} onClick={() => setOpen('rename')}>
            {t('admin.firmware.rename')}
          </button>
          {/* The server refuses while a channel still points at the build, so
              the app refuses it here with the same reason rather than sending a
              write that is known to come back. */}
          <button
            type="button"
            className={`${ui.chip} ${ui.danger}`}
            disabled={pointers.length > 0}
            title={pointers.length > 0 ? t('admin.firmware.inUse') : undefined}
            onClick={() => setOpen('delete')}
          >
            {t('admin.firmware.delete')}
          </button>
        </span>
        {pointers.length > 0 ? <span className={styles.consequence}>{t('admin.firmware.inUse')}</span> : null}

        <OutOfTheRow>
          {open === 'upload' ? <UploadSheet build={build} onClose={() => setOpen(null)} /> : null}
          {open === 'rename' ? <RenameSheet build={build} onClose={() => setOpen(null)} /> : null}
          {open === 'delete' ? <DeleteSheet build={build} onClose={() => setOpen(null)} /> : null}
        </OutOfTheRow>
      </td>
    </tr>
  );
}

/**
 * One file of a build. The device asks for a file by name, so the name is part
 * of the address and is offered as the file's own - which is what a build
 * container writes and what the device was built to ask for.
 */
function UploadSheet({ build, onClose }: { build: Firmware; onClose: () => void }) {
  const { t } = useTranslation();
  const upload = useUploadBinary();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');

  return (
    <Sheet
      title={t('admin.firmware.uploadTitle')}
      aside={build.version}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={!file || name.trim() === '' || upload.isPending}
          onClick={() => file && upload.mutate({ firmwareId: build.id, name: name.trim(), file }, { onSuccess: onClose })}
        >
          {t('admin.firmware.uploadIt')}
        </button>
      }
    >
      <p className={styles.sheetBody}>{t('admin.firmware.uploadBody')}</p>
      <label className={styles.field}>
        <span className="label">{t('admin.firmware.file')}</span>
        <input
          className={ui.input}
          type="file"
          onChange={event => {
            const picked = event.target.files?.[0] ?? null;
            setFile(picked);
            if (picked && name.trim() === '') setName(picked.name);
          }}
        />
      </label>
      <label className={styles.field}>
        <span className="label">{t('admin.firmware.fileName')}</span>
        <input className={ui.input} value={name} autoComplete="off" onChange={event => setName(event.target.value)} />
      </label>
      {file ? <p className={styles.consequence}>{t('admin.count.bytes', { count: file.size })}</p> : null}
      <Refused error={upload.error} />
    </Sheet>
  );
}

/** Relabelling. The version stays what the container stamped; only the name a person reads changes, and an empty one takes it away. */
function RenameSheet({ build, onClose }: { build: Firmware; onClose: () => void }) {
  const { t } = useTranslation();
  const rename = useUpdateFirmware();

  return (
    <NameSheet
      title={t('admin.firmware.renameTitle')}
      aside={build.version}
      fields={{ name: { label: t('admin.firmware.buildName'), value: build.name ?? '' } }}
      error={rename.error}
      busy={rename.isPending}
      save={t('admin.firmware.renameIt')}
      ready={() => true}
      onSave={({ name }) => rename.mutate({ firmwareId: build.id, body: { name: name || null } }, { onSuccess: onClose })}
      onClose={onClose}
    />
  );
}

/** Deleting a build takes its files with it, and a device part way through installing it has nothing left to fetch. */
function DeleteSheet({ build, onClose }: { build: Firmware; onClose: () => void }) {
  const { t } = useTranslation();
  const remove = useDeleteFirmware();

  return (
    <Sheet
      title={t('admin.firmware.deleteTitle')}
      aside={build.version}
      onClose={onClose}
      actions={
        <Answer
          yes={t('admin.firmware.deleteIt')}
          danger
          disabled={remove.isPending}
          onYes={() => remove.mutate(build.id, { onSuccess: onClose })}
          onCancel={onClose}
        />
      }
    >
      <p className={styles.sheetBody}>{t('admin.firmware.deleteBody', { build: build.name ?? build.version })}</p>
      <Refused error={remove.error} />
    </Sheet>
  );
}
