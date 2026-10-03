import { useTranslation } from 'react-i18next';
import type { GerminationChoices as Choices } from '@fg2/shared-types/v1';
import { GERMINATION_TOO_HUMID } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { Help } from '@/ui/Help';
import type { HelpTopic } from '@/ui/explain';
import ui from '@/ui/ui.module.css';
import { targetFigure, UNIT } from '../../home/units';
import styles from './GerminationChoices.module.css';

/**
 * The two choices germination makes about the humidity, wherever germination
 * is set: the targets, the operating mode, a phase with its climate and a plan
 * step. Each is a switch with what it does said under it, in the same words in
 * all four places, and a help bubble that says why the default is what it is.
 *
 * The humidifier's switch is offered only where a socket is paired as one: on
 * a device without, nothing reads the humidity in the dark and there is nothing
 * to choose. `humidity` is the night's, which a humidifier that holds goes by;
 * null where the screen cannot say it, and the note then names it in words.
 * Where it holds more than "Zu feucht" lets pass and the grower asked to be
 * warned, the two choices work against each other, and that is said.
 */
export function GerminationChoices({
  value,
  onChange,
  humidifier,
  humidity,
  disabled = false,
}: {
  value: Choices;
  onChange: (change: Partial<Choices>) => void;
  humidifier: boolean;
  humidity: number | null;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const held = humidity === null ? null : `${targetFigure(humidity, 'humidity')} ${UNIT.humidity ?? '%'}`;
  const clashes = humidifier && value.humidifierHolds && value.warnTooHumid && humidity !== null && humidity > GERMINATION_TOO_HUMID;

  return (
    <div className={styles.choices} role="group" aria-label={t('germinationChoices.label')}>
      <span className="label">{t('germinationChoices.label')}</span>
      <Switch
        label={t('germinationChoices.alarm')}
        help="germinationAlarm"
        note={t(value.warnTooHumid ? 'germinationChoices.alarmOn' : 'germinationChoices.alarmOff', { line: GERMINATION_TOO_HUMID })}
        on={value.warnTooHumid}
        disabled={disabled}
        onToggle={warnTooHumid => onChange({ warnTooHumid })}
      />
      {humidifier ? (
        <Switch
          label={t('germinationChoices.humidifier')}
          help="germinationHumidifier"
          note={
            value.humidifierHolds
              ? held === null
                ? t('germinationChoices.humidifierOnNight')
                : t('germinationChoices.humidifierOn', { humidity: held })
              : t('germinationChoices.humidifierOff')
          }
          on={value.humidifierHolds}
          disabled={disabled}
          onToggle={humidifierHolds => onChange({ humidifierHolds })}
        />
      ) : null}
      {clashes ? <p className={ui.note}>{t('germinationChoices.holdsAboveLine', { line: GERMINATION_TOO_HUMID })}</p> : null}
    </div>
  );
}

function Switch({
  label,
  help,
  note,
  on,
  disabled,
  onToggle,
}: {
  label: string;
  help: HelpTopic;
  note: string;
  on: boolean;
  disabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <div className={styles.toggle} data-keep>
      <span className={styles.toggleText}>
        <span className={styles.toggleLabel}>
          {label}
          <Help topic={help} />
        </span>
        <span className={ui.note}>{note}</span>
      </span>
      <button
        type="button"
        className={ui.switch}
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onToggle(!on)}
      >
        <span className={ui.knob} aria-hidden />
      </button>
    </div>
  );
}
