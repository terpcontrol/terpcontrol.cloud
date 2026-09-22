import type { ReactNode } from 'react';
import ui from '@/ui/ui.module.css';
import styles from './Notifications.module.css';

/** The switch every card and every cell of the grid carries: the same control as a socket's, drawn on a setting. */
export function Switch({ name, on, disabled, onToggle }: { name: string; on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={ui.switch} role="switch" aria-checked={on} aria-label={name} disabled={disabled} onClick={onToggle}>
      <span className={ui.knob} aria-hidden />
    </button>
  );
}

/**
 * A channel: its name, one line about where it stands, and the switch at the
 * right. Whatever the channel needs beyond the switch - a field, a link, a
 * refusal - goes underneath, inside the same card.
 */
export function ChannelCard({
  title,
  line,
  on,
  disabled,
  onToggle,
  children,
}: {
  title: string;
  line: ReactNode;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={`${ui.card} ${styles.channel}`}>
      <div className={styles.channelHead}>
        <div className={styles.channelText}>
          <span className={styles.channelTitle}>{title}</span>
          <span className={`${ui.note} ${styles.channelLine}`}>{line}</span>
        </div>
        <Switch name={title} on={on} disabled={disabled} onToggle={onToggle} />
      </div>
      {children}
    </div>
  );
}
