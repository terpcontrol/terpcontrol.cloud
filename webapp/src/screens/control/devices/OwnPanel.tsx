import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DateTime } from 'luxon';
import type { Device } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useHeardAt } from '@/api/devices';
import { ageAttribute, deviceLiveness, offlineLabel } from '@/ui/age';
import { Help } from '@/ui/Help';
import type { HelpTopic } from '@/ui/explain';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { CLOCK, nowThere, useZone } from '@/ui/zone';
import type { Unsaved } from '../targets/LeaveGuard';
import { secondsOf, wallClock } from '../targets/targets-draft';
import type { FieldsDraft } from './fields-draft';
import targets from '../targets/Targets.module.css';

/**
 * The frame of what a device that is not a climate controller is set to under
 * Steuerung - a smart socket, an AIR fan, a LIGHT: its name where the place
 * holds more than one device, its settings, and the bar that saves them, as
 * the targets above it are saved. Leaving with something unsaved asks first,
 * through the same question the targets use.
 */
export function OwnPanel({
  device,
  name,
  titled,
  mayManage,
  draft,
  report,
  asking,
  invalid = null,
  children,
}: {
  device: Device;
  name: string;
  titled: boolean;
  mayManage: boolean;
  draft: FieldsDraft;
  report: (deviceId: string, entry: Unsaved | null) => void;
  asking: boolean;
  /** Why the draft cannot be saved as it stands, said over the bar. */
  invalid?: string | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const heard = useHeardAt(device);
  const [sentAt, setSentAt] = useState<DateTime | null>(null);

  const commit = async (): Promise<boolean> => {
    if (invalid) return false;
    const done = await draft.save();
    if (done) setSentAt(serverNow());
    return done;
  };

  // Handed up while there is something to lose; read through a ref, because
  // the draft a question saves is the one standing when it is answered.
  const latest = useRef(commit);
  useEffect(() => {
    latest.current = commit;
  });
  const unsaved = draft.dirty && mayManage;
  const discard = draft.discard;
  useEffect(() => {
    if (!unsaved) return;
    report(device.id, { save: () => latest.current(), discard });
    return () => report(device.id, null);
  }, [unsaved, device.id, report, discard]);

  return (
    <section className={targets.panel} aria-label={name}>
      {titled ? <h2 className={targets.deviceName}>{name}</h2> : null}
      {children}

      {mayManage ? null : <p className={ui.note}>{t('targets.readOnly')}</p>}

      {sentAt && !draft.dirty ? (
        <p className={`mono ${targets.sent}`} role="status">
          {t('ownPanel.sentAt', { time: nowThere(sentAt, zone).toFormat(CLOCK) })}
          <span className={targets.sentNote}>{t('ownPanel.sentNote')}</span>
        </p>
      ) : null}

      {deviceLiveness(heard, now) === 'offline' ? (
        <p className={`mono ${targets.quiet}`} {...ageAttribute('offline')}>
          {t('space.control.applied.quiet', { offline: offlineLabel(heard, now, zone, true) })}
        </p>
      ) : null}

      {draft.dirty && mayManage && !asking ? (
        <div className={`${ui.card} ${targets.bar}`}>
          <span className={targets.barText}>{draft.isPending ? t('targets.saving') : (invalid ?? t('targets.unsaved'))}</span>
          <button type="button" className={ui.button} disabled={draft.isPending} onClick={draft.discard}>
            {t('targets.discard')}
          </button>
          <button type="button" className={`${ui.button} ${ui.primary}`} disabled={draft.isPending || invalid !== null} onClick={() => void commit()}>
            {t('targets.save')}
          </button>
          <Refused error={draft.error} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * A time of day, on the account's wall clock: the firmware keeps it as seconds
 * past midnight UTC, and the server moves those when the clock changes, so the
 * time read here is the one that stays.
 *
 * A time field hands over a whole time after every keystroke and nothing while
 * a part of it is cleared, so the field keeps what is typed while it has the
 * focus and the draft takes every whole time it hands over.
 */
export function TimeRow({
  id,
  label,
  help,
  seconds,
  offset,
  disabled,
  aside,
  onChange,
}: {
  id: string;
  label: string;
  help?: HelpTopic;
  /** In the document's seconds past midnight UTC. */
  seconds: number;
  /** How far the account's wall clock is ahead of UTC, in seconds. */
  offset: number;
  disabled: boolean;
  aside?: ReactNode;
  onChange: (seconds: number) => void;
}) {
  const [typing, setTyping] = useState<string | null>(null);

  return (
    <div className={`${targets.row} ${targets.clockRow}`}>
      <label className={targets.rowLabel} htmlFor={id}>
        {label}
        {help ? <Help topic={help} /> : null}
      </label>
      <span className={targets.clockValue}>
        <input
          id={id}
          className={`mono ${ui.input} ${targets.clock}`}
          type="time"
          value={typing ?? wallClock(seconds, offset)}
          disabled={disabled}
          onChange={event => {
            const time = event.target.value;
            setTyping(document.activeElement === event.target ? time : null);
            const next = secondsOf(time, offset);
            if (next !== null) onChange(next);
          }}
          onBlur={() => setTyping(null)}
        />
        {aside ? <span className={`mono ${targets.aside}`}>{aside}</span> : null}
      </span>
    </div>
  );
}
