import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { HelpTopic } from '@/ui/explain';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import { ClockStepper, Stepper } from '../targets/Stepper';
import fields from '../targets/DayNight.module.css';
import styles from './Climate.module.css';

/**
 * A figure of a card, and the way to its sheet: a button for whoever may set
 * it, the figure alone for whoever may only read. One stored for a device
 * that is not heard is drawn in the amber of what it has not been handed.
 */
export function FigureButton({
  name,
  text,
  pending,
  word = false,
  onOpen,
}: {
  name: string;
  text: string;
  pending: boolean;
  /** Words rather than a figure - one of a few choices - which wrap where a figure must not. */
  word?: boolean;
  onOpen: (() => void) | null;
}) {
  const { t } = useTranslation();

  return onOpen ? (
    <button
      type="button"
      className={styles.figure}
      data-pending={pending || undefined}
      data-word={word || undefined}
      aria-label={t(pending ? 'control.figure.changePending' : 'control.figure.change', { name, value: text.replace(/\u00a0/g, ' ') })}
      onClick={onOpen}
    >
      {text}
    </button>
  ) : (
    <span className={styles.figure} data-pending={pending || undefined} data-word={word || undefined} data-read>
      {text}
    </span>
  );
}

/** One figure of a sheet: a number in its range, or a time of day on the account's clock. */
export interface SheetFigure {
  key: string;
  /** What it is called: over its stepper where the sheet holds several, and to a screen reader. */
  label: string;
  value: number;
  /** A time of day, kept as the document keeps it - seconds past midnight UTC - `offset` seconds behind the account's clock. */
  clock?: { offset: number };
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  unit?: string;
}

export type SheetValues = Readonly<Record<string, number>>;

/**
 * The sheet a setting of a device is changed on: the figure with − and +
 * either side of it, what it amounts to under it, and "Speichern", before
 * which nothing is written. A sheet holds several figures only where they
 * make sense together - a socket's two switch points, a window's start and
 * its length.
 */
export function ValueSheet({
  title,
  help,
  figures,
  fresh = false,
  busy,
  error,
  invalid,
  extra,
  children,
  onSave,
  onClose,
}: {
  title: string;
  help?: HelpTopic;
  figures: readonly SheetFigure[];
  /** Nothing is stored yet - a window being added - so the figures may be saved as they stand. */
  fresh?: boolean;
  busy: boolean;
  error: Error | null;
  /** Why the figures cannot be saved as they stand; null where they can. */
  invalid?: (values: SheetValues) => string | null;
  /** A second button beside "Speichern", such as the one that removes what the sheet is about. */
  extra?: ReactNode;
  /** What the figures amount to, what saving them does beyond storing them, and - through `set` - a figure offered ready-made. */
  children?: (values: SheetValues, set: (key: string, value: number) => void) => ReactNode;
  onSave: (values: SheetValues) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [moved, setMoved] = useState<SheetValues>({});
  const [asked, setAsked] = useState(false);
  const whyId = useId();
  const values: SheetValues = Object.fromEntries(figures.map(figure => [figure.key, moved[figure.key] ?? figure.value]));
  const changed = figures.some(figure => values[figure.key] !== figure.value);
  const why = invalid?.(values) ?? null;

  const save = async () => {
    setAsked(true);
    if (await onSave(values)) onClose();
  };

  return (
    <Sheet
      title={title}
      aside={help ? <Help topic={help} /> : undefined}
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={busy || why !== null || !(changed || fresh)}
            aria-describedby={why ? whyId : undefined}
            onClick={() => void save()}
          >
            {t(busy ? 'targets.saving' : 'targets.save')}
          </button>
          {extra}
        </>
      }
    >
      <div className={styles.sheet}>
        <div className={figures.length > 1 ? fields.fields : undefined}>
          {figures.map(figure => {
            const name = figures.length > 1 ? `${title}: ${figure.label}` : figure.label;
            const set = (value: number) => setMoved({ ...moved, [figure.key]: value });
            const stepper = figure.clock ? (
              <ClockStepper
                name={name}
                seconds={values[figure.key]}
                offset={figure.clock.offset}
                less={t('targets.plan.earlier', { name })}
                more={t('targets.plan.later', { name })}
                changed={values[figure.key] !== figure.value}
                disabled={busy}
                onChange={set}
              />
            ) : (
              <Stepper
                name={name}
                value={values[figure.key]}
                min={figure.min ?? 0}
                max={figure.max ?? 100}
                step={figure.step ?? 1}
                decimals={figure.decimals ?? 0}
                unit={figure.unit}
                less={t('targets.stepLess', { name })}
                more={t('targets.stepMore', { name })}
                changed={values[figure.key] !== figure.value}
                padded
                disabled={busy}
                onChange={set}
              />
            );

            return figures.length > 1 ? (
              <div key={figure.key} className={fields.field}>
                <span className={fields.fieldLabel}>{figure.label}</span>
                {stepper}
              </div>
            ) : (
              <span key={figure.key}>{stepper}</span>
            );
          })}
        </div>
        {children?.(values, (key, value) => setMoved({ ...moved, [key]: value }))}
        {why ? (
          <p className={styles.warn} id={whyId} role="status">
            {why}
          </p>
        ) : null}
        {asked ? <Refused error={error} /> : null}
      </div>
    </Sheet>
  );
}
