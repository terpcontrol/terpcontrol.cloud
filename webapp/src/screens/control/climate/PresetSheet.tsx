import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, GerminationChoices as ChoiceValues } from '@fg2/shared-types/v1';
import { GERMINATION_HUMIDITY } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { useHome } from '@/api/home';
import { useDiaryLayer } from '@/api/layers';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { CLIMATE_CHOICES, climateChoiceName, type ClimateChoice } from '@/ui/presets';
import { Sheet } from '@/ui/Sheet';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { targetFigure } from '@/ui/units';
import { GerminationChoices } from '../germination/GerminationChoices';
import { choicesOf } from '../germination/germination-choices';
import { hoursWritten } from '../targets/schedule-words';
import { shapeOf, type Shape } from '../targets/day-night';
import { prefilled, presetOf, type TargetsDraft } from '../targets/targets-draft';
import { figureName, figureText, movedFields, spellChangeOf } from './figures';
import styles from './Climate.module.css';

/**
 * A stage's climate, taken over: the chips, what the one picked would set -
 * each figure it moves, from what to what - and whether it starts or ends a
 * drying spell or a germination, all before "Übernehmen" writes it. A preset
 * moves the targets and nothing else; the grow's phase is moved in the grow.
 */
export function PresetSheet({
  device,
  shape,
  baseline,
  hasCo2,
  humidifier,
  chosen,
  pauses,
  busy,
  error,
  onSave,
  onClose,
}: {
  device: Device;
  shape: Shape;
  baseline: TargetsDraft;
  hasCo2: boolean;
  humidifier: boolean;
  /** The preset the stored figures are, which is the chip drawn chosen until another is picked. */
  chosen: ClimateChoice | null;
  pauses: (next: TargetsDraft, chip: ClimateChoice, choices?: ChoiceValues) => string | null;
  busy: boolean;
  error: Error | null;
  onSave: (next: TargetsDraft, chip: ClimateChoice, choices?: ChoiceValues) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<ClimateChoice | null>(null);
  const [changes, setChanges] = useState<Partial<ChoiceValues> | null>(null);
  const [asked, setAsked] = useState(false);
  const home = useHome();
  const diary = useDiaryLayer();
  const grow = diary ? ((home.data?.spaces ?? []).find(card => card.spaceId === device.spaceId)?.grow ?? null) : null;

  const preset = picked ? presetOf(picked) : null;
  const next = preset ? prefilled(baseline, preset) : baseline;
  const drying = spellChangeOf(picked, device, 'drying');
  const germination = spellChangeOf(picked, device, 'germination');
  const germinates = picked ? picked.stage === 'germination' : shape.regime === 'germination';
  const choices: ChoiceValues = { ...choicesOf(device), ...(changes ?? {}) };
  const after = picked
    ? shapeOf(device, next, { drying: picked.stage === 'drying', germination: germinates, humidified: humidifier && choices.humidifierHolds })
    : shape;
  // A tent without a CO2 sensor has no CO2 to set, and a fan no lamp: what the preset says of them is not a change here.
  const moved = movedFields(next, baseline).filter(
    field => (field !== 'co2' || hasCo2) && (device.type !== 'fan' || (field !== 'co2' && field !== 'lightLimit')),
  );
  const hours = next.lightHours !== baseline.lightHours && device.type !== 'fan';
  const sets = picked !== null && (moved.length > 0 || hours || drying !== null || germination !== null || changes !== null);
  const said = germinates && changes !== null ? choices : undefined;
  const paused = picked && sets ? pauses(next, picked, said) : null;

  const save = async () => {
    if (!picked) return;
    setAsked(true);
    if (await onSave(next, picked, said)) onClose();
  };

  return (
    <Sheet
      title={t('control.preset.title')}
      aside={<Help topic="climatePreset" />}
      onClose={onClose}
      actions={
        <button type="button" className={`${ui.button} ${ui.primary}`} disabled={busy || !sets} onClick={() => void save()}>
          {t(busy ? 'targets.saving' : 'control.preset.take')}
        </button>
      }
    >
      <div className={styles.sheet}>
        <Choices label={t('targets.presets')}>
          {CLIMATE_CHOICES.map(chip => (
            <Choice
              key={`${chip.stage}:${chip.preset ?? ''}`}
              chosen={picked ? chip === picked : chip === chosen}
              disabled={busy}
              onChoose={() => {
                setPicked(chip);
                setChanges(null);
              }}
            >
              {climateChoiceName(t, chip)}
            </Choice>
          ))}
        </Choices>

        {picked && !sets ? <p className={styles.note}>{t('control.preset.same')}</p> : null}
        {picked && (moved.length > 0 || hours) ? (
          <ul className={styles.sets} aria-label={t('control.preset.sets')}>
            {moved.map(field => (
              <li key={field}>
                <span>{figureName(t, field, after.regime)}</span>
                <span className="mono">
                  {figureText(field, baseline[field])} → {figureText(field, next[field])}
                </span>
              </li>
            ))}
            {hours ? (
              <li>
                <span>{t('targets.aria.lightHours')}</span>
                <span className="mono">
                  {hoursWritten(baseline.lightHours)} → {hoursWritten(next.lightHours)}&nbsp;{t('targets.unit.hours')}
                </span>
              </li>
            ) : null}
          </ul>
        ) : null}
        {drying || germination ? (
          <p className={styles.note} role="status">
            {t(drying ? `targets.drying.${drying}` : `targets.germination.${germination}`, {
              humidity: targetFigure(GERMINATION_HUMIDITY, 'humidity'),
            })}
          </p>
        ) : null}
        {/* Germination regulates no humidity of its own; what it does about it is the grower's to say. */}
        {picked && germinates ? (
          <GerminationChoices
            value={choices}
            onChange={change => setChanges({ ...(changes ?? {}), ...change })}
            humidifier={humidifier}
            humidity={next.nightHumidity}
            disabled={busy}
          />
        ) : null}
        {sets && grow?.stage ? (
          <p className={styles.note}>{t('targets.growStays', { name: grow.name, stage: t(`home.stage.${grow.stage}`) })}</p>
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
