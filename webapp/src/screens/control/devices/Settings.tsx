import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import advanced from '@/ui/advanced/Advanced.module.css';
import { fieldValue } from '@/ui/advanced/field-values';
import type { HelpTopic } from '@/ui/explain';
import { Help, Named } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import { Choice, Choices } from '@/ui/SheetParts';
import { Switch } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
import { fieldOf, type PendingItem } from '../climate/figures';
import { PendingNote } from '../climate/Pending';
import type { Settings } from '../climate/saved';
import { FigureButton, ValueSheet } from '../climate/ValueSheet';
import climate from '../climate/Climate.module.css';
import { figureSaid, onOff } from './setting-words';
import styles from './Own.module.css';

/**
 * What a device's settings beyond its targets are drawn with, wherever they
 * stand: a block of lines, each a name with what it is set to. A figure opens
 * the value sheet, one of a few its sheet of choices, and a switch is written
 * on the tap; every write goes through the block's one `useSettings`. Whoever
 * may not manage the device reads the same lines and is offered no control.
 */

interface SettingProps {
  device: Device;
  settings: Settings;
  mayManage: boolean;
  /** The setting's name in `CONFIGURATION_FIELDS`. */
  name: string;
  label: string;
  help?: HelpTopic;
}

/** A block of settings: a card, under its own heading where the page has not said it already - or, in the card of Erweitert, a group of lines. */
export function SettingsBlock({
  title,
  label,
  help,
  pending = [],
  error = null,
  children,
}: {
  title?: string;
  /** What a card without a heading is called to a screen reader. */
  label?: string;
  help?: HelpTopic;
  /** What the device has not been handed of this block, said in its one note. */
  pending?: readonly PendingItem[];
  error?: Error | null;
  children: ReactNode;
}) {
  const said = (
    <>
      <PendingNote items={pending} />
      <Refused error={error} />
    </>
  );

  return title || label ? (
    <section className={`${ui.panel} ${climate.card}`} aria-label={title ?? label}>
      {title ? (
        <h2 className={`${ui.cardHeading} ${climate.title}`}>
          {title}
          {help ? <Help topic={help} /> : null}
        </h2>
      ) : null}
      {children}
      {said}
    </section>
  ) : (
    <div className={advanced.row}>
      {children}
      {said}
    </div>
  );
}

/** One line of a block: what the setting is called, and beside it what it is set to. */
export function SettingLine({ label, help, pending = false, children }: { label: string; help?: HelpTopic; pending?: boolean; children: ReactNode }) {
  return (
    <div className={styles.line} data-pending={pending || undefined}>
      <span className={styles.name}>
        <Named label={label} topic={help} />
      </span>
      <span className={styles.set}>{children}</span>
    </div>
  );
}

/** A figure in the range `CONFIGURATION_FIELDS` holds it to, changed on the value sheet. */
export function NumberSetting({
  device,
  settings,
  mayManage,
  name,
  label,
  help,
  unit,
  decimals = 0,
  step,
  fallback = null,
  invalid,
}: SettingProps & {
  unit: string;
  decimals?: number;
  /** Why a figure cannot be saved beside the others of its block; null where it can. */
  invalid?: (value: number) => string | null;
  /** A coarser step than the range allows, where nobody sets the figure to the unit. */
  step?: number;
  /** What the firmware runs with where its document does not state the figure, shown rather than nothing. */
  fallback?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const field = fieldOf(device, name);
  if (field?.kind !== 'number') return null;
  const stored = fieldValue(device, name);
  const standing = typeof stored === 'number' ? stored : fallback;
  const say = figureSaid(unit, decimals);

  return (
    <SettingLine label={label} help={help}>
      <FigureButton
        name={label}
        text={standing === null ? '–' : say(standing)}
        pending={settings.held(name) !== undefined}
        onOpen={mayManage ? () => setOpen(true) : null}
      />
      {open ? (
        <ValueSheet
          title={label}
          figures={[{ key: name, label, value: standing ?? field.min, min: field.min, max: field.max, step: step ?? field.step, decimals, unit }]}
          fresh={standing === null}
          busy={settings.busy}
          error={settings.error}
          invalid={invalid ? values => invalid(values[name]) : undefined}
          onSave={values => settings.write({ [name]: values[name] }, held => `${label} ${say(held[name])}`)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </SettingLine>
  );
}

/** One switch, written on the tap. */
export function SwitchSetting({ device, settings, mayManage, name, label, help, disabled = false }: SettingProps & { disabled?: boolean }) {
  const { t } = useTranslation();
  const on = (settings.asked(name) ?? fieldValue(device, name)) === true;

  return (
    <SettingLine label={label} help={help} pending={settings.held(name) !== undefined}>
      {mayManage ? (
        <Switch
          label={label}
          on={on}
          disabled={disabled || settings.busy}
          onChange={next => void settings.write({ [name]: next }, held => `${label} ${onOff(t, Boolean(held[name]))}`)}
        />
      ) : (
        <span className={styles.read}>{onOff(t, on)}</span>
      )}
    </SettingLine>
  );
}

interface Option {
  value: string;
  label: string;
}

/** One of a few, chosen on a sheet of its own. */
export function ChoiceSetting({
  device,
  settings,
  mayManage,
  name,
  label,
  help,
  options,
  says,
}: SettingProps & {
  options: readonly Option[];
  /** What choosing an option does beyond storing it, said before the save. */
  says?: (value: string) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const chosen = fieldValue(device, name);
  const word = (value: unknown) => options.find(option => option.value === value)?.label ?? '–';

  return (
    <SettingLine label={label} help={help}>
      <FigureButton
        word
        name={label}
        text={word(chosen)}
        pending={settings.held(name) !== undefined}
        onOpen={mayManage ? () => setOpen(true) : null}
      />
      {open ? (
        <ChoiceSheet
          title={label}
          help={help}
          options={options}
          chosen={typeof chosen === 'string' ? chosen : null}
          says={says}
          busy={settings.busy}
          error={settings.error}
          onSave={value => settings.write({ [name]: value }, held => `${label} ${word(held[name])}`)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </SettingLine>
  );
}

/** The chips of a choice, what the one picked does, and "Speichern", before which nothing is written. */
export function ChoiceSheet({
  title,
  help,
  options,
  chosen,
  says,
  busy,
  error,
  onSave,
  onClose,
}: {
  title: string;
  help?: HelpTopic;
  options: readonly Option[];
  chosen: string | null;
  says?: (value: string) => string | null;
  busy: boolean;
  error: Error | null;
  onSave: (value: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const moved = picked !== null && picked !== chosen;
  const does = moved ? (says?.(picked) ?? null) : null;

  const save = async () => {
    if (!moved) return;
    setAsked(true);
    if (await onSave(picked)) onClose();
  };

  return (
    <Sheet
      title={title}
      aside={help ? <Help topic={help} /> : undefined}
      onClose={onClose}
      actions={
        <button type="button" className={`${ui.button} ${ui.primary}`} disabled={busy || !moved} onClick={() => void save()}>
          {t(busy ? 'targets.saving' : 'targets.save')}
        </button>
      }
    >
      <div className={ui.stack3}>
        <Choices label={title}>
          {options.map(option => (
            <Choice key={option.value} chosen={option.value === (picked ?? chosen)} disabled={busy} onChoose={() => setPicked(option.value)}>
              {option.label}
            </Choice>
          ))}
        </Choices>
        {does ? (
          <p className={climate.note} role="status">
            {does}
          </p>
        ) : null}
        {asked ? <Refused error={error} /> : null}
      </div>
    </Sheet>
  );
}
