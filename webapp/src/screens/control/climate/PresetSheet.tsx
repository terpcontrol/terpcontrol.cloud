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
import { FIGURES, figureName, figureText, movedFields, spellChangeOf, type FigureField } from './figures';
import styles from './Climate.module.css';

/**
 * A stage's climate, taken over: the chips, what the one picked would set -
 * each figure it moves, from what to what - and whether it starts or ends a
 * drying spell or a germination, all before "Übernehmen" writes it. A preset
 * moves the targets and nothing else; the grow's phase is moved in the grow.
 *
 * This is the one place a device is put into germination or drying and taken
 * out of them: by another preset, or - while such a spell runs - by the chip
 * that ends it without a new climate, which says what the server then puts
 * back. While it germinates, what germination does about the humidity is
 * changed here too, without taking the preset again.
 */
export function PresetSheet({
  device,
  shape,
  baseline,
  hasCo2,
  humidifier,
  chosen,
  pauses,
  runs,
  busy,
  error,
  onSave,
  onEnd,
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
  /** The running plan, by name: ending a spell pauses it. */
  runs: string | null;
  busy: boolean;
  error: Error | null;
  /** `label` is what the toast says was saved. */
  onSave: (next: TargetsDraft, chip: ClimateChoice, choices: ChoiceValues | undefined, label: string) => Promise<boolean>;
  /** Ends the spell that runs and leaves the climate to what the server kept from before it. */
  onEnd: (spell: 'drying' | 'germination') => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<ClimateChoice | null>(null);
  const [ending, setEnding] = useState(false);
  const [changes, setChanges] = useState<Partial<ChoiceValues> | null>(null);
  const [asked, setAsked] = useState(false);
  const running = shape.regime === 'drying' || shape.regime === 'germination' ? shape.regime : null;
  const home = useHome();
  const diary = useDiaryLayer();
  const grow = diary ? ((home.data?.spaces ?? []).find(card => card.spaceId === device.spaceId)?.grow ?? null) : null;

  const preset = picked ? presetOf(picked) : null;
  const next = preset ? prefilled(baseline, preset) : baseline;
  const drying = spellChangeOf(picked, device, 'drying');
  const germination = spellChangeOf(picked, device, 'germination');
  const germinates = !ending && (picked ? picked.stage === 'germination' : shape.regime === 'germination');
  const choices: ChoiceValues = { ...choicesOf(device), ...(changes ?? {}) };
  const after = picked
    ? shapeOf(device, next, { drying: picked.stage === 'drying', germination: germinates, humidified: humidifier && choices.humidifierHolds })
    : shape;
  // A tent without a CO2 sensor has no CO2 to set, and a fan no lamp: what the preset says of them is not a change here.
  // A spell holds the night's figures round the clock, so the day's are not named beside them under the same words.
  const spell = after.regime === 'drying' || after.regime === 'germination';
  const moved = movedFields(next, baseline).filter(
    field =>
      (field !== 'co2' || hasCo2) &&
      (device.type !== 'fan' || (field !== 'co2' && field !== 'lightLimit')) &&
      !(spell && FIGURES[field].half === 'day' && field !== 'co2'),
  );
  const hours = next.lightHours !== baseline.lightHours && device.type !== 'fan';
  // Ending a spell by itself puts back what it wrote over, figure by figure where the server kept it.
  const kept: Partial<Record<FigureField, number | null>> =
    (running === 'drying' ? device.control?.afterDrying : device.control?.afterGermination) ?? {};
  const figures = ending
    ? (Object.keys(FIGURES) as FigureField[]).flatMap(field => {
        const to = kept[field] ?? null;
        return to === null || to === baseline[field] || (field === 'co2' && !hasCo2) ? [] : [{ field, to }];
      })
    : moved.map(field => ({ field, to: next[field] }));
  const said = germinates && changes !== null ? choices : undefined;
  const sets = (picked !== null && (moved.length > 0 || hours || drying !== null || germination !== null)) || said !== undefined;
  // Unpicked, the choices of a germination that runs are saved with the stage it is in.
  const chip = picked ?? CLIMATE_CHOICES.find(one => one.stage === 'germination') ?? null;
  const paused = ending ? runs : chip && sets ? pauses(next, chip, said) : null;

  const save = async () => {
    if (!chip) return;
    setAsked(true);
    const label = picked ? t('control.preset.taken', { name: climateChoiceName(t, picked) }) : t('germinationChoices.label');
    if (await (ending && running ? onEnd(running) : onSave(next, chip, said, label))) onClose();
  };

  return (
    <Sheet
      title={t('control.preset.title')}
      aside={<Help topic="climatePreset" />}
      onClose={onClose}
      actions={
        <button type="button" className={`${ui.button} ${ui.primary}`} disabled={busy || !(sets || ending)} onClick={() => void save()}>
          {t(busy ? 'targets.saving' : 'control.preset.take')}
        </button>
      }
    >
      <div className={ui.stack3}>
        <Choices label={t('targets.presets')}>
          {CLIMATE_CHOICES.map(chip => (
            <Choice
              key={`${chip.stage}:${chip.preset ?? ''}`}
              chosen={!ending && (picked ? chip === picked : chip === chosen)}
              disabled={busy}
              onChoose={() => {
                setPicked(chip);
                setEnding(false);
                setChanges(null);
              }}
            >
              {climateChoiceName(t, chip)}
            </Choice>
          ))}
          {running ? (
            <Choice
              chosen={ending}
              disabled={busy}
              onChoose={() => {
                setPicked(null);
                setEnding(true);
              }}
            >
              {t(`control.preset.end.${running}`)}
            </Choice>
          ) : null}
        </Choices>

        {picked && !sets ? <p className={styles.note}>{t('control.preset.same')}</p> : null}
        {figures.length > 0 || hours ? (
          <ul className={styles.sets} aria-label={t(ending ? 'control.preset.returns' : 'control.preset.sets')}>
            {figures.map(({ field, to }) => (
              <li key={field}>
                <span>{figureName(t, field, ending ? 'cycle' : after.regime)}</span>
                <span className="mono">
                  {figureText(field, baseline[field])} → {figureText(field, to)}
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
        {ending || drying || germination ? (
          <p className={styles.note} role="status">
            {t(ending ? `targets.${running}.ends` : drying ? `targets.drying.${drying}` : `targets.germination.${germination}`, {
              humidity: targetFigure(GERMINATION_HUMIDITY, 'humidity'),
            })}
          </p>
        ) : null}
        {/* Germination regulates no humidity of its own; what it does about it is the grower's to say. */}
        {germinates ? (
          <GerminationChoices
            value={choices}
            onChange={change => setChanges({ ...(changes ?? {}), ...change })}
            humidifier={humidifier}
            humidity={next.nightHumidity}
            disabled={busy}
          />
        ) : null}
        {(sets || ending) && grow?.stage ? (
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
