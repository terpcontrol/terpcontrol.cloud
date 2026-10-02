import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { configurationFieldsOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { useConfigure } from '@/api/devices';
import type { HelpTopic } from '@/ui/explain';
import { Refused } from '@/ui/PageState';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { SettingRow } from './SettingRow';
import { fieldValue } from './field-values';
import styles from './Advanced.module.css';

/**
 * The controls a setting of a device's document is changed with, by the name
 * `CONFIGURATION_FIELDS` gives it for the device's type: the range comes from
 * that table, the value from the device, and a change goes out on the tap
 * through `PATCH /devices/{id}/configuration`. What is shown while the write is
 * on its way is what was asked for; what is shown after it is what the server
 * stored, which for the work mode is not always the same.
 */

interface FieldProps {
  device: Device;
  /** Drawn on its own, outside an Erweitert section. */
  alone?: boolean;
  /** The setting's name in `CONFIGURATION_FIELDS`. */
  name: string;
  label: string;
  help?: HelpTopic;
  disabled?: boolean;
}

/** One switch, written on the tap. */
export function FieldSwitch({ device, name, label, help, disabled, alone, note }: FieldProps & { note?: (on: boolean) => React.ReactNode }) {
  const configure = useConfigure(device.id);
  const asked = configure.isPending ? configure.variables?.[name] : undefined;
  const on = (asked ?? fieldValue(device, name)) === true;

  return (
    <>
      <SettingRow label={label} help={help} note={note?.(on)} alone={alone}>
        <button
          type="button"
          className={ui.switch}
          role="switch"
          aria-checked={on}
          aria-label={label}
          disabled={disabled || configure.isPending}
          onClick={() => configure.mutate({ [name]: !on })}
        >
          <span className={ui.knob} aria-hidden />
        </button>
      </SettingRow>
      <Refused error={configure.error} />
    </>
  );
}

/** One of a few, as chips under the name, with what the chosen one means under them. */
export function FieldChoice({
  device,
  name,
  label,
  help,
  disabled,
  options,
}: FieldProps & { options: { value: string; label: string; note?: string }[] }) {
  const configure = useConfigure(device.id);
  const asked = configure.isPending ? configure.variables?.[name] : undefined;
  const chosen = asked ?? fieldValue(device, name);

  return (
    <>
      <SettingRow label={label} help={help} note={options.find(option => option.value === chosen)?.note} wide>
        <Choices label={label}>
          {options.map(option => (
            <Choice
              key={option.value}
              chosen={option.value === chosen}
              disabled={disabled || configure.isPending}
              onChoose={() => (option.value === chosen ? undefined : configure.mutate({ [name]: option.value }))}
            >
              {option.label}
            </Choice>
          ))}
        </Choices>
      </SettingRow>
      <Refused error={configure.error} />
    </>
  );
}

/**
 * A figure, typed and then saved, so that a half-typed number is never sent.
 * The range is the table's, and a figure outside it is refused here with the
 * range in the words the server would refuse it in.
 */
export function FieldNumber({
  device,
  name,
  label,
  help,
  disabled,
  unit,
  note,
  fallback = null,
}: FieldProps & {
  unit: string;
  note?: React.ReactNode;
  /** What the firmware runs with where its document does not state the figure, shown rather than an empty field. */
  fallback?: number | null;
}) {
  const { t } = useTranslation();
  const configure = useConfigure(device.id);
  const field = configurationFieldsOf(device.type)[name];
  const stored = fieldValue(device, name);
  const [typed, setTyped] = useState<string | null>(null);
  if (field?.kind !== 'number') return null;

  const standing = typeof stored === 'number' ? stored : fallback;
  const shown = typed ?? (standing === null ? '' : String(standing));
  const wanted = Number(shown.replace(',', '.'));
  const fits = shown.trim() !== '' && Number.isFinite(wanted) && wanted >= field.min && wanted <= field.max;
  const changed = typed !== null && wanted !== standing;

  return (
    <>
      <SettingRow label={label} help={help} note={typed !== null && !fits ? t('advanced.range', { min: field.min, max: field.max, unit }) : note}>
        <input
          className={`${ui.input} ${styles.number}`}
          inputMode="numeric"
          value={shown}
          aria-label={label}
          disabled={disabled || configure.isPending}
          onChange={event => setTyped(event.target.value)}
        />
        <span className="mono">{unit}</span>
        {changed ? (
          <button
            type="button"
            className={ui.chip}
            disabled={!fits || configure.isPending}
            onClick={() => configure.mutate({ [name]: wanted }, { onSuccess: () => setTyped(null) })}
          >
            {t('advanced.save')}
          </button>
        ) : null}
      </SettingRow>
      <Refused error={configure.error} />
    </>
  );
}
