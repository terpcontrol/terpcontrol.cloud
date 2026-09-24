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
 * right. A channel with something to change puts a chip next to its switch
 * rather than its fields, so that every card at rest is the same height and
 * the column reads as four equal things. What the chip opens - a field, a
 * question, a refusal - goes underneath, inside the same card.
 */
export function ChannelCard({
  title,
  line,
  on,
  disabled,
  onToggle,
  action,
  children,
}: {
  title: string;
  line: ReactNode;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`${ui.card} ${ui.joined} ${styles.channel}`}>
      <div className={styles.channelHead}>
        <div className={styles.channelText}>
          <span className={styles.channelTitle}>{title}</span>
          <span className={`${ui.note} ${styles.channelLine}`}>{line}</span>
        </div>
        <div className={styles.channelActions}>
          {action}
          <Switch name={title} on={on} disabled={disabled} onToggle={onToggle} />
        </div>
      </div>
      {children}
    </div>
  );
}
