import { useId, type ReactNode } from 'react';
import type { HelpTopic } from './explain';
import { Help } from './Help';
import ui from './ui.module.css';
import styles from './Switch.module.css';

/** The app's one switch: the same control on a socket, a setting, a channel and a cell of a grid. */
export function Switch({
  label,
  on,
  disabled,
  describedBy,
  onChange,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  /** The id of what the switch does in the position it is in, said after its name and state. */
  describedBy?: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={ui.switch}
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className={ui.knob} aria-hidden />
    </button>
  );
}

/**
 * A switch with what it means beside it: the label, the help that says why,
 * and a line on what the switch does in the position it is in.
 *
 * `keep` marks the whole row as what a screen with a save bar keeps clear of
 * the bar after a change, as it does a row of the targets.
 */
export function SwitchRow({
  label,
  note,
  help,
  on,
  disabled,
  keep,
  onChange,
}: {
  label: string;
  note?: ReactNode;
  help?: HelpTopic;
  on: boolean;
  disabled?: boolean;
  keep?: boolean;
  onChange: (on: boolean) => void;
}) {
  const noteId = useId();

  return (
    <div className={styles.row} data-keep={keep ? '' : undefined}>
      <span className={styles.text}>
        <span className={styles.label}>
          {label}
          {help ? <Help topic={help} /> : null}
        </span>
        {note ? (
          <span className={ui.note} id={noteId}>
            {note}
          </span>
        ) : null}
      </span>
      <Switch label={label} on={on} disabled={disabled} describedBy={note ? noteId : undefined} onChange={onChange} />
    </div>
  );
}
