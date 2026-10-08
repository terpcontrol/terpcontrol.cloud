import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { durationLabel } from '@/ui/age';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import styles from './Devices.module.css';

/**
 * What a row has to say once it is opened: one fact per line, the name of it on
 * the left and the figure on the right. A device and a socket both have some,
 * so the shape is stated once.
 */
export function Facts({ children }: { children: React.ReactNode }) {
  return <dl className={styles.facts}>{children}</dl>;
}

export function Fact({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt className="label">{label}</dt>
      <dd className={`mono ${styles.factValue}`}>{value}</dd>
    </div>
  );
}

/** The chevron a row opens and closes by. Without `onToggle` the row's head does the toggling and the button only says which way it stands. */
export function Expand({ open, label, onToggle }: { open: boolean; label: string; onToggle?: () => void }) {
  return (
    <button type="button" className={styles.expand} aria-expanded={open} aria-label={label} onClick={onToggle}>
      {open ? <ChevronDown size={16} strokeWidth={2} aria-hidden /> : <ChevronRight size={16} strokeWidth={2} aria-hidden />}
    </button>
  );
}

/**
 * What a switch command answered. MQTT hands back no receipt, so the honest
 * line is that it went out and whether anybody was listening - never that the
 * output switched - and, for a hold, how long it was asked to hold for: a device
 * reports no override of its own output, so a hold whose length is not stated
 * here is a lamp forced on with no word about when it hands itself back.
 */
export function Receipt({
  result,
  error,
  pending,
  heldFor,
}: {
  result?: { deviceOnline: boolean };
  error: Error | null;
  pending: boolean;
  heldFor?: number | null;
}) {
  const { t } = useTranslation();

  if (pending) return <p className={`${ui.note} ${styles.socketWhy}`}>{t('devices.socket.asking')}</p>;
  if (error) return <Refused error={error} fallback={t('devices.socket.askFailed')} className={styles.socketWhy} />;
  if (!result) return null;

  return (
    <p className={`${ui.note} ${styles.socketWhy}`} role="status">
      {!result.deviceOnline
        ? t('devices.socket.notListening')
        : heldFor == null
          ? t('devices.socket.asked')
          : t('devices.lightOutput.askedHold', { duration: durationLabel(heldFor) })}
    </p>
  );
}
