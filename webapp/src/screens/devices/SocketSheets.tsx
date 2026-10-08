import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceCapabilities, SocketRole } from '@fg2/shared-types/v1';
import { useRemoveSocket, useSetSocket } from '@/api/devices';
import { Sheet } from '@/ui/Sheet';
import { SettingRow } from '@/ui/advanced/SettingRow';
import { durationLabel } from '@/ui/age';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { Choice, Choices, SheetAnswer } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { draftFor, isTimed, problemOf, rolesFor, TIMER_UNITS, timerOf, updateOf, type SocketDraft, type Span, type TimerUnit } from './socket-form';
import type { SocketRowModel } from './sockets';
import styles from './Sockets.module.css';

/**
 * Pairing a socket by its address, and changing or removing one: what a Tasmota
 * socket can only be given from here, and what a paired one rarely needs again,
 * because the device finds its sockets by their hardware id when the network
 * moves them. So all of it stands under Erweitert - in the device's panel while
 * it has no socket yet, under its list of sockets once it has.
 *
 * Every one of them is a command and answers a receipt: what was sent and
 * whether anybody was listening. The row itself changes when the device next
 * sends its table, which it does within half a minute.
 */

/** The line under Erweitert that opens the pairing. */
export function PairSocketRow({ deviceId, deviceName, capabilities }: { deviceId: string; deviceName: string; capabilities: DeviceCapabilities }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);

  return (
    <>
      <SettingRow label={t('socketForm.pair.label')} help="advanced.pairSocket" note={t('socketForm.pair.note')}>
        <button type="button" className={ui.chip} onClick={() => setAsking(true)}>
          {t('socketForm.pair.open')}
        </button>
      </SettingRow>
      {asking ? (
        <SocketSheet deviceId={deviceId} deviceName={deviceName} capabilities={capabilities} socket={null} onClose={() => setAsking(false)} />
      ) : null}
    </>
  );
}

/**
 * Pairing a new socket (`socket` null) or changing one the table holds. A
 * changed socket keeps its slot, and its credentials unless new ones are typed.
 */
function SocketSheet({
  deviceId,
  deviceName,
  capabilities,
  socket,
  name,
  onClose,
}: {
  deviceId: string;
  deviceName: string;
  capabilities: DeviceCapabilities;
  socket: SocketRowModel | null;
  /** What the socket being changed is called in its row. */
  name?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const send = useSetSocket();
  const [draft, setDraft] = useState<SocketDraft>(() => draftFor(socket));
  const [tried, setTried] = useState(false);
  const roles = rolesFor(capabilities, socket?.role ?? null);
  // A row an old table names by its role alone, or a socket the device keeps no address for, has nothing a change could be sent to.
  const slot = socket ? (socket.slot >= 0 ? socket.slot : null) : null;
  const unreachable = socket !== null && (slot === null || socket.address === '');
  const problem = problemOf(draft, capabilities);
  const receipt = send.data ?? null;
  const word = socket ? 'edit' : 'pair';

  const submit = () => {
    setTried(true);
    if (problem || unreachable) return;
    send.mutate({ deviceId, slot, socket: updateOf(draft) });
  };

  const actions = (
    <SheetAnswer done={receipt !== null} error={send.error} onClose={onClose}>
      <button type="button" className={`${ui.button} ${ui.primary}`} disabled={send.isPending || roles.length === 0 || unreachable} onClick={submit}>
        {t(`socketForm.${word}.yes`)}
      </button>
    </SheetAnswer>
  );

  return (
    <Sheet
      title={socket ? t('socketForm.edit.title', { name: name ?? t(socket.titleKey) }) : t('socketForm.pair.title')}
      onClose={onClose}
      actions={actions}
    >
      <div className={styles.form} role={receipt ? 'status' : undefined}>
        {receipt ? (
          <p>{receipt.deviceOnline ? t(`socketForm.${word}.sent`, { device: deviceName }) : t('socketForm.unheard', { device: deviceName })}</p>
        ) : (
          <>
            {socket ? null : <p className={ui.note}>{t('socketForm.pair.intro', { device: deviceName })}</p>}
            {roles.length === 0 ? <p className={ui.note}>{t('socketForm.noRoles')}</p> : null}
            {unreachable ? <p className={ui.note}>{t('socketForm.edit.noAddress')}</p> : null}

            <RolePick roles={roles} chosen={draft.role} disabled={roles.length === 0} onChoose={role => setDraft({ ...draft, role })} />

            <label className={styles.field}>
              <span className="label">{t('socketForm.address')}</span>
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
              <span className={ui.note}>{t('socketForm.addressHint')}</span>
            </label>

            <div className={styles.field}>
              <div className={styles.pair}>
                <label className={styles.field}>
                  <span className="label">{t('socketForm.username')}</span>
                  <input
                    className={ui.input}
                    value={draft.username}
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
                    autoComplete="new-password"
                    onChange={event => setDraft({ ...draft, password: event.target.value })}
                  />
                </label>
              </div>
              <span className={ui.note}>{t(socket ? 'socketForm.credentialsKeep' : 'socketForm.credentialsHint')}</span>
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
            <p className={ui.note}>{t('socketForm.reach')}</p>
          </>
        )}
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
function CycleFields({
  draft,
  onChange,
  disabled,
}: {
  draft: Pick<SocketDraft, 'on' | 'every'>;
  onChange: (next: SocketDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const set = (key: 'on' | 'every', span: Span) => onChange({ ...(draft as SocketDraft), [key]: span });

  return (
    // Two phrases that break between each other and never inside one: "an für [2] [Min]" / "alle [6] [Std]".
    <div className={styles.cycle}>
      <span className={styles.phrase}>
        <span>{t('socketForm.cycle.on')}</span>
        <SpanField label={t('socketForm.cycle.onLabel')} span={draft.on} disabled={disabled} onChange={span => set('on', span)} />
      </span>
      <span className={styles.phrase}>
        <span>{t('socketForm.cycle.every')}</span>
        <SpanField label={t('socketForm.cycle.everyLabel')} span={draft.every} disabled={disabled} onChange={span => set('every', span)} />
      </span>
    </div>
  );
}

function SpanField({ label, span, disabled, onChange }: { label: string; span: Span; disabled?: boolean; onChange: (span: Span) => void }) {
  const { t } = useTranslation();

  return (
    <span className={styles.span}>
      <input
        className={`mono ${ui.input} ${styles.spanValue}`}
        inputMode="decimal"
        aria-label={label}
        value={span.value}
        disabled={disabled}
        onChange={event => onChange({ ...span, value: event.target.value })}
      />
      <select
        className={`${ui.input} ${styles.spanUnit}`}
        aria-label={t('socketForm.cycle.unitLabel', { what: label })}
        value={span.unit}
        disabled={disabled}
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

/**
 * The timer of a pump or a timer of one's own, in its row: what it repeats, and
 * a short form to change it. Without one such a socket stays off, which the row
 * says rather than leaving somebody to wonder why the pump never ran.
 */
export function SocketTimerBlock({
  deviceId,
  row,
  capabilities,
  refusal,
}: {
  deviceId: string;
  row: SocketRowModel;
  capabilities: DeviceCapabilities;
  /** Why nothing can be sent to the device now, or null. */
  refusal: string | null;
}) {
  const { t } = useTranslation();
  const send = useSetSocket();
  const [draft, setDraft] = useState<SocketDraft | null>(null);
  const cycle = draft ? timerOf(draft) : null;
  // A change is sent with the socket's address, which an old table may not carry.
  const blocked = !capabilities.socketTimer
    ? t('socketForm.problem.timerFirmware')
    : row.address === '' || row.slot < 0
      ? t('socketForm.edit.noAddress')
      : refusal;

  const save = () => {
    if (!draft || !cycle) return;
    send.mutate(
      { deviceId, slot: row.slot, socket: { role: row.role, address: row.address, credentials: null, timer: cycle } },
      { onSuccess: () => setDraft(null) },
    );
  };

  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <span className="label">
          {t('socketForm.timer.label')}
          <Help topic="socketTimer" />
        </span>
        {draft === null ? (
          <button type="button" className={ui.chip} disabled={blocked !== null} onClick={() => setDraft(draftFor(row))}>
            {t(row.timer ? 'socketForm.timer.change' : 'socketForm.timer.set')}
          </button>
        ) : null}
      </div>
      {draft === null ? (
        <p className={row.timer ? `mono ${ui.note}` : ui.problem}>
          {row.timer
            ? t('socketForm.timer.value', { on: durationLabel(row.timer.onSeconds), every: durationLabel(row.timer.everySeconds) })
            : t('socketForm.timer.missing')}
        </p>
      ) : (
        <>
          <CycleFields draft={draft} onChange={setDraft} disabled={send.isPending} />
          {cycle ? null : <p className={ui.problem}>{t('socketForm.problem.timer')}</p>}
          <div className={styles.actions}>
            <button type="button" className={`${ui.button} ${ui.primary}`} disabled={!cycle || send.isPending} onClick={save}>
              {t('socketForm.timer.save')}
            </button>
            <button type="button" className={ui.button} onClick={() => setDraft(null)}>
              {t('maintenance.cancel')}
            </button>
          </div>
        </>
      )}
      {blocked && draft === null ? <p className={ui.note}>{blocked}</p> : null}
      <Refused error={send.error} />
      {send.data && draft === null ? (
        <p className={ui.note} role="status">
          {t(send.data.deviceOnline ? 'devices.socket.asked' : 'devices.socket.notListening')}
        </p>
      ) : null}
    </div>
  );
}

/** Under a socket's holds, folded: changing where it is reached, and removing it. */
export function SocketAdvanced({
  deviceId,
  deviceName,
  name,
  row,
  capabilities,
  unheard,
}: {
  deviceId: string;
  deviceName: string;
  /** What the row is called, numbered where its role holds several. */
  name: string;
  row: SocketRowModel;
  capabilities: DeviceCapabilities;
  unheard: string | null;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);

  return (
    <details className={styles.advanced}>
      <summary className="label">{t('advanced.title')}</summary>
      <SettingRow label={t('socketForm.edit.label')} help="advanced.editSocket">
        <button type="button" className={ui.chip} onClick={() => setEditing(true)}>
          {t('socketForm.edit.open')}
        </button>
      </SettingRow>
      {/* Offline, the holds above already say why it is grey. */}
      <SettingRow label={t('socketForm.remove.label')} help="advanced.removeSocket">
        <button type="button" className={`${ui.chip} ${ui.danger}`} disabled={unheard !== null || row.slot < 0} onClick={() => setRemoving(true)}>
          {t('socketForm.remove.open')}
        </button>
      </SettingRow>
      {editing ? (
        <SocketSheet
          deviceId={deviceId}
          deviceName={deviceName}
          capabilities={capabilities}
          socket={row}
          name={name}
          onClose={() => setEditing(false)}
        />
      ) : null}
      {removing ? <RemoveSheet deviceId={deviceId} row={row} name={name} onClose={() => setRemoving(false)} /> : null}
    </details>
  );
}

function RemoveSheet({ deviceId, row, name, onClose }: { deviceId: string; row: SocketRowModel; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const remove = useRemoveSocket();
  const receipt = remove.data ?? null;

  return (
    <Sheet
      title={t('socketForm.remove.title', { name })}
      onClose={onClose}
      actions={
        <SheetAnswer done={receipt !== null} error={remove.error} onClose={onClose}>
          <button type="button" className={ui.dangerOutline} disabled={remove.isPending} onClick={() => remove.mutate({ deviceId, slot: row.slot })}>
            {t('socketForm.remove.yes')}
          </button>
        </SheetAnswer>
      }
    >
      <div className={styles.form} role={receipt ? 'status' : undefined}>
        {receipt ? (
          <p>{t(receipt.deviceOnline ? 'socketForm.remove.sent' : 'devices.socket.notListening')}</p>
        ) : (
          <p>{t('socketForm.remove.text', { address: row.address || '—' })}</p>
        )}
      </div>
    </Sheet>
  );
}
