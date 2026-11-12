import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { Term } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import { figure, UNIT } from '@/ui/units';
import type { Regime } from '../targets/day-night';
import { Stepper } from '../targets/Stepper';
import { leafOffset, vpdOf, type TargetsDraft } from '../targets/targets-draft';
import { FIGURES, figureName, type FigureField } from './figures';
import styles from './Climate.module.css';

/**
 * One figure, changed by itself: the stepper, the VPD a temperature or a
 * humidity makes with its partner, and - where a running plan writes this
 * figure - that saving pauses the plan, said before the tap.
 */
export function FigureSheet({
  device,
  field,
  regime,
  baseline,
  pauses,
  busy,
  error,
  onSave,
  onClose,
}: {
  device: Device;
  field: FigureField;
  regime: Regime;
  baseline: TargetsDraft;
  /** The plan a save of this draft pauses, by name; null where it pauses none. */
  pauses: (next: TargetsDraft) => string | null;
  busy: boolean;
  error: Error | null;
  onSave: (next: TargetsDraft) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(baseline[field]);
  const [asked, setAsked] = useState(false);
  const spec = FIGURES[field];
  const name = figureName(t, field, regime);
  const next = { ...baseline, [field]: value };
  const paused = pauses(next);
  const unit = spec.metric === 'light' ? '%' : (UNIT[spec.metric] ?? '');
  const half = spec.half;
  const vpd =
    half && (spec.metric === 'temperature' || spec.metric === 'humidity')
      ? figure(
          vpdOf(
            half === 'day' ? next.dayTemperature : next.nightTemperature,
            half === 'day' ? next.dayHumidity : next.nightHumidity,
            leafOffset(device.settings, half),
          ),
          'vpd',
        )
      : null;

  const save = async () => {
    setAsked(true);
    if (await onSave(next)) onClose();
  };

  return (
    <Sheet
      title={name}
      onClose={onClose}
      actions={
        <button type="button" className={`${ui.button} ${ui.primary}`} disabled={busy || value === baseline[field]} onClick={() => void save()}>
          {t(busy ? 'targets.saving' : 'targets.save')}
        </button>
      }
    >
      <div className={styles.sheet}>
        <Stepper
          name={name}
          value={value}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          decimals={spec.decimals}
          unit={unit}
          less={t('targets.stepLess', { name })}
          more={t('targets.stepMore', { name })}
          changed={value !== baseline[field]}
          disabled={busy}
          onChange={setValue}
        />
        {vpd ? (
          <p className={`mono ${styles.derived}`}>
            <Term topic="vpd">{t('targets.table.vpd', { value: vpd })}</Term>
          </p>
        ) : null}
        {paused ? (
          <p className={styles.warn} role="status">
            {t('targets.planTable.pauses', { name: paused })}
          </p>
        ) : null}
        {asked ? <Refused error={error} /> : null}
      </div>
    </Sheet>
  );
}
