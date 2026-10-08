import { useState, type ReactNode } from 'react';
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
import { useReportUnsaved } from '../targets/report-unsaved';
import { TimeInput } from '../TimeInput';
import type { FieldsDraft } from './fields-draft';
import targets from '../targets/Targets.module.css';
import styles from './Own.module.css';

export interface OwnPanelProps {
  device: Device;
  name: string;
  titled: boolean;
  mayManage: boolean;
  report: (deviceId: string, entry: Unsaved | null) => void;
  asking: boolean;
}

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
}: OwnPanelProps & {
  draft: FieldsDraft;
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

  useReportUnsaved(report, device.id, draft.dirty && mayManage, { save: commit, discard: draft.discard });

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
  return (
    <div className={styles.row}>
      <label className={styles.rowLabel} htmlFor={id}>
        {label}
        {help ? <Help topic={help} /> : null}
      </label>
      <span>
        <TimeInput id={id} className={`mono ${ui.input}`} seconds={seconds} offset={offset} disabled={disabled} onChange={onChange} />
        {aside ? <span className={`mono ${styles.aside}`}>{aside}</span> : null}
      </span>
    </div>
  );
}
