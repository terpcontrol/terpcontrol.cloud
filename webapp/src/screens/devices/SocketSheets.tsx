import { useQueryClient } from '@tanstack/react-query';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceCapabilities, SocketPage, SocketRole } from '@fg2/shared-types/v1';
import { useRemoveSocket, useSetSocket } from '@/api/devices';
import { leaveUnderSheet } from '@/app/places';
import { useLog } from '@/log/log-context';
import { Sheet } from '@/ui/Sheet';
import { Facts } from '@/ui/Facts';
import { Help } from '@/ui/Help';
import { Row } from '@/ui/Rows';
import { Choice, Choices, SheetAnswer } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { draftFor, isTimed, problemOf, rolesFor, TIMER_UNITS, updateOf, type SocketDraft, type Span, type TimerUnit } from './socket-form';
import { answerSoon, forgetRow, type SocketRowModel } from './sockets';
import styles from './Sockets.module.css';

/**
 * Pairing a socket by its address, and changing or removing one. A paired
 * socket rarely needs either again: the device finds its sockets by their
 * hardware id when the network moves them. Pairing stands on the device's
 * page, changing and removing on the socket's own.
 *
 * Every one of them is a command: a device that was listening is answered
 * with a toast and the sheet goes; one that was not leaves the sheet open and
 * says that nothing changed. The socket itself changes when the device next
 * sends its table, which is read again on the way (`answerSoon`).
 */

/** How long a socket that was sent may take to stand in the device's table before the row stops saying it is on its way. */
const PAIRING_MS = 60_000;

/**
 * "Steckdose koppeln" among a device's rows: how many it has, and the sheet
 * that pairs another by its address. The sockets themselves are listed where
 * they are switched - under their device on Steuerung and under Ausgänge.
 */
export function PairSocketRow({
  deviceId,
  deviceName,
  table,
  failed,
  unheard,
  now,
}: {
  deviceId: string;
  deviceName: string;
  table: SocketPage | undefined;
  /** The table could not be read. */
  failed: boolean;
  /** Nobody is listening on the device, so pairing waits. */
  unheard: boolean;
  now: DateTime;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  /** A socket was sent: how many the table held then, and when. */
  const [sent, setSent] = useState<{ count: number; at: number } | null>(null);
  const count = table?.items.length ?? null;
  if (sent && count !== sent.count) setSent(null);

  return (
    <>
      <Row
        title={t('socketForm.pair.label')}
        line={
          <Facts
            facts={[
              count === null ? failed && t('device.sockets.unread') : t(count ? 'device.sockets.paired' : 'device.sockets.none', { count }),
              sent && now.toMillis() - sent.at < PAIRING_MS ? t('device.sockets.pairing') : null,
              unheard ? t('device.socket.waits') : null,
            ]}
          />
        }
        waits={unheard || !table}
        onOpen={() => setOpen(true)}
      />
      {open && table ? (
        <SocketFormSheet
          deviceId={deviceId}
          deviceName={deviceName}
          capabilities={table.capabilities}
          socket={null}
          onSent={() => setSent({ count: table.items.length, at: now.toMillis() })}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Pairing a new socket (`socket` null) or changing one the table holds. A
 * changed socket keeps its slot, and its credentials unless new ones are typed.
 */
export function SocketFormSheet({
  deviceId,
  deviceName,
  capabilities,
  socket,
  name,
  onSent,
  onClose,
}: {
  deviceId: string;
  deviceName: string;
  capabilities: DeviceCapabilities;
  socket: SocketRowModel | null;
  /** What the socket being changed is called in its row. */
  name?: string;
  /** The device was listening and has been told. */
  onSent?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const client = useQueryClient();
  const send = useSetSocket();
  const [draft, setDraft] = useState<SocketDraft>(() => draftFor(socket));
  const [tried, setTried] = useState(false);
  const roles = rolesFor(capabilities, socket?.role ?? null);
  // A row an old table names by its role alone, or a socket the device keeps no address for, has nothing a change could be sent to.
  const slot = socket ? (socket.slot >= 0 ? socket.slot : null) : null;
  const unreachable = socket !== null && (slot === null || socket.address === '');
  const problem = problemOf(draft, capabilities);
  const word = socket ? 'edit' : 'pair';

  const submit = () => {
    setTried(true);
    if (problem || unreachable || send.isPending) return;
    send.mutate(
      { deviceId, slot, socket: updateOf(draft) },
      {
        onSuccess: ({ deviceOnline }) => {
          if (!deviceOnline) return;
          answerSoon(client, deviceId);
          tell({ label: t(`socketForm.${word}.told`, { name: t(`devices.role.${draft.role}`) }), undo: null });
          onSent?.();
          onClose();
        },
      },
    );
  };

  return (
    <Sheet
      title={socket ? t('socketForm.edit.title', { name: name ?? t(socket.titleKey) }) : t('socketForm.pair.title')}
      onClose={onClose}
      actions={
        <SheetAnswer done={false} error={send.error} onClose={onClose}>
          <button type="button" className={`${ui.button} ${ui.primary}`} disabled={roles.length === 0 || unreachable} onClick={submit}>
            {t(`socketForm.${word}.yes`)}
          </button>
        </SheetAnswer>
      }
    >
      <div className={styles.form}>
        {roles.length === 0 ? <p className={ui.note}>{t('socketForm.noRoles')}</p> : null}
        {unreachable ? <p className={ui.note}>{t('socketForm.edit.noAddress')}</p> : null}

        <RolePick roles={roles} chosen={draft.role} disabled={roles.length === 0} onChoose={role => setDraft({ ...draft, role })} />

        <label className={styles.field}>
          <span className="label">
            {t('socketForm.address')}
            <Help topic="socketAddress" />
          </span>
          <input
            className={`mono ${ui.input}`}
            aria-label={t('socketForm.address')}
            value={draft.address}
            placeholder="192.168.1.50"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={event => setDraft({ ...draft, address: event.target.value })}
          />
        </label>

        <div className={styles.pair}>
          <label className={styles.field}>
            <span className="label">{t('socketForm.username')}</span>
            <input
              className={ui.input}
              value={draft.username}
              placeholder={t(`socketForm.credentials.${word}`)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={event => setDraft({ ...draft, username: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className="label">{t('socketForm.password')}</span>
            <input
              className={ui.input}
              type="password"
              value={draft.password}
              placeholder={t(`socketForm.credentials.${word}`)}
              autoComplete="new-password"
              onChange={event => setDraft({ ...draft, password: event.target.value })}
            />
          </label>
        </div>

        {draft.role && isTimed(draft.role) ? (
          <div className={styles.field}>
            <span className="label">
              {t('socketForm.cycle.label')}
              <Help topic="socketTimer" />
            </span>
            <CycleFields draft={draft} onChange={setDraft} />
          </div>
        ) : null}

        {tried && problem ? <p className={ui.problem}>{t(`socketForm.problem.${problem}`)}</p> : null}
        {send.data?.deviceOnline === false ? (
          <p className={ui.problem} role="alert">
            {t('socketForm.unheard', { device: deviceName })}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function RolePick({
  roles,
  chosen,
  disabled,
  onChoose,
}: {
  roles: SocketRole[];
  chosen: SocketRole | null;
  disabled: boolean;
  onChoose: (role: SocketRole) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className={styles.field}>
      <span className="label">
        {t('socketForm.role')}
        <Help topic="socketRoles" />
      </span>
      <Choices label={t('socketForm.role')}>
        {roles.map(role => (
          <Choice key={role} chosen={role === chosen} disabled={disabled} onChoose={() => onChoose(role)}>
            {t(`devices.role.${role}`)}
          </Choice>
        ))}
      </Choices>
    </div>
  );
}

/** "on for [2] [min] every [6] [h]". */
function CycleFields({ draft, onChange }: { draft: SocketDraft; onChange: (next: SocketDraft) => void }) {
  const { t } = useTranslation();

  return (
    // Two phrases that break between each other and never inside one: "an für [2] [Min]" / "alle [6] [Std]".
    <div className={styles.cycle}>
      <span className={styles.phrase}>
        <span>{t('socketForm.cycle.on')}</span>
        <SpanField label={t('socketForm.cycle.onLabel')} span={draft.on} onChange={on => onChange({ ...draft, on })} />
      </span>
      <span className={styles.phrase}>
        <span>{t('socketForm.cycle.every')}</span>
        <SpanField label={t('socketForm.cycle.everyLabel')} span={draft.every} onChange={every => onChange({ ...draft, every })} />
      </span>
    </div>
  );
}

function SpanField({ label, span, onChange }: { label: string; span: Span; onChange: (span: Span) => void }) {
  const { t } = useTranslation();

  return (
    <span className={styles.span}>
      <input
        className={`mono ${ui.input} ${styles.spanValue}`}
        inputMode="decimal"
        aria-label={label}
        value={span.value}
        onChange={event => onChange({ ...span, value: event.target.value })}
      />
      <select
        className={`${ui.input} ${styles.spanUnit}`}
        aria-label={t('socketForm.cycle.unitLabel', { what: label })}
        value={span.unit}
        onChange={event => onChange({ ...span, unit: event.target.value as TimerUnit })}
      >
        {TIMER_UNITS.map(({ unit }) => (
          <option key={unit} value={unit}>
            {t(`units.${unit}`)}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Whether the device should forget a socket, asked first; once it was told, the socket is off the screen and `onRemoved` leads away. */
export function RemoveSocketSheet({
  deviceId,
  row,
  name,
  onClose,
  onRemoved,
}: {
  deviceId: string;
  row: SocketRowModel;
  name: string;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const client = useQueryClient();
  const remove = useRemoveSocket();

  const send = () => {
    if (remove.isPending) return;
    remove.mutate(
      { deviceId, slot: row.slot },
      {
        onSuccess: ({ deviceOnline }) => {
          if (!deviceOnline) return;
          forgetRow(client, deviceId, row);
          answerSoon(client, deviceId);
          tell({ label: t('socketForm.remove.told', { name }), undo: null });
          // The socket's page is gone with it: what follows takes its entry of the history, not the sheet's.
          leaveUnderSheet(onRemoved);
        },
      },
    );
  };

  return (
    <Sheet
      title={t('socketForm.remove.title', { name })}
      onClose={onClose}
      actions={
        <SheetAnswer done={false} error={remove.error} onClose={onClose}>
          <button type="button" className={ui.dangerOutline} onClick={send}>
            {t('socketForm.remove.yes')}
          </button>
        </SheetAnswer>
      }
    >
      <div className={styles.form}>
        <p>{t('socketForm.remove.text', { address: row.address || '—' })}</p>
        {remove.data?.deviceOnline === false ? (
          <p className={ui.problem} role="alert">
            {t('devices.socket.notListening')}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
