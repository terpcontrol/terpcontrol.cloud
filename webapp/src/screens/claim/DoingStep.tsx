import { useTranslation } from 'react-i18next';
import type { GrowthStage } from '@fg2/shared-types/v1';
import { climatePreset, GERMINATION_HUMIDITY, GERMINATION_TEMPERATURE, STAGES_WITH_CLIMATE } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { serverNow } from '@/api/clock';
import { useDevices } from '@/api/devices';
import { type useApplyPreset } from '@/api/lifecycle';
import { Refused } from '@/ui/PageState';
import { stageChoiceName } from '@/ui/presets';
import { Choice, Choices } from '@/ui/SheetParts';
import { statesTargets } from '@/ui/climate-hardware';
import ui from '@/ui/ui.module.css';
import { offsetOf } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import { GerminationChoices } from '../control/germination/GerminationChoices';
import { choicesOf, useHumidifier } from '../control/germination/germination-choices';
import { usePlaceController } from '../grow/phase-climate';
import { scheduleTitle } from '../control/targets/schedule-words';
import { draftOf } from '../control/targets/targets-draft';
import { targetFigure } from '@/ui/units';
import { MEASURE, presetBodyOf, type Doing } from './steps';
import styles from './Claim.module.css';

/**
 * The third step: what the tent is doing right now.
 *
 * A stage is not a label on this screen - it is the climate the controller is
 * put on, and the phase whatever is growing here enters - so picking one is a
 * write and is drawn as one, with what it did reported afterwards in the
 * server's own terms. `curing` is not offered because a jar is not steered; the
 * stages with a climate are the contract's list rather than a second copy of it.
 *
 * What grows here is not asked on this step: the flow ends with that question
 * (`GrowStep`), where an answer starts the grow.
 *
 * The write is the step's own action and not the screen's, so it is drawn as
 * the lesser of the two: the green on this screen belongs to the button on the
 * bottom edge, which carries the choice into the write if it has not been made
 * yet rather than stepping past it. That button says where it goes next and not
 * what it writes, so the write has to be announced: the step stays on screen
 * and the lines below it change, neither of which is read out on its own.
 */
export function DoingStep({
  spaceId,
  doing,
  onDoing,
  apply,
}: {
  spaceId: string | null;
  doing: Doing;
  onDoing: (doing: Doing) => void;
  apply: ReturnType<typeof useApplyPreset>;
}) {
  const { t } = useTranslation();
  // What germination does about the humidity, asked as everywhere germination is set. The screen holds the
  // answer, because its own button carries the choice into the write as well.
  const controller = usePlaceController(spaceId);
  const humidifier = useHumidifier(controller);

  const { chosen, applied } = doing;
  const stage = chosen === MEASURE ? null : chosen;
  const pick = (next: GrowthStage | typeof MEASURE) => onDoing({ chosen: next, applied: null, germination: doing.germination });
  // Whether a controller actually took the targets. A place whose device has
  // never sent its settings takes nothing, and the lines below then have no
  // climate write to report.
  const wrote = (applied?.deviceIds.length ?? 0) > 0;
  const window = useWindowOf(spaceId, applied?.stage ?? stage);
  const wroteLine = applied ? (wrote ? t('claim.doing.wroteTo', { count: applied.deviceIds.length }) : t('claim.doing.wroteNothing')) : '';
  const phaseLine = applied?.phaseId
    ? t('claim.doing.phaseWritten', { stage: t(`home.stage.${applied.stage}`) })
    : t(wrote ? 'claim.doing.noPhaseWritten' : 'claim.doing.noPhaseNoClimate');

  return (
    <>
      {/* A live region has to be on the page and empty before it is filled, so
          this one is always drawn and says nothing until a write has happened.
          What it reads is what the lines below say, so nothing is read twice. */}
      <p className={ui.visuallyHidden} role="status">
        {applied ? [wroteLine, phaseLine].join(' ') : ''}
      </p>

      <Choices label={t('claim.doing.pick')}>
        {STAGES_WITH_CLIMATE.map(one => (
          <Choice key={one} chosen={chosen === one} disabled={apply.isPending} onChoose={() => pick(one)}>
            {stageChoiceName(t, one)}
          </Choice>
        ))}
        <Choice chosen={chosen === MEASURE} disabled={apply.isPending} onChoose={() => pick(MEASURE)}>
          {t('claim.doing.measure')}
        </Choice>
      </Choices>

      {chosen === MEASURE ? <p className={ui.note}>{t('claim.doing.measureNote')}</p> : null}
      {/* A stage sets how long the light is on from the hour the device already
          has, so the hours are said as the window they make before anything is
          written - eighteen of them from eight in the morning burn until two. */}
      {stage && !applied && window ? <p className={ui.note}>{t('claim.doing.window', { light: window })}</p> : null}
      {/* Germination has no window to say: it is dark, and says what it holds instead. */}
      {stage === 'germination' && !applied ? (
        <p className={ui.note}>
          {t('claim.doing.germination', {
            temperature: targetFigure(GERMINATION_TEMPERATURE, 'temperature'),
            humidity: targetFigure(GERMINATION_HUMIDITY, 'humidity'),
          })}
        </p>
      ) : null}
      {stage === 'germination' && !applied && controller?.control ? (
        <GerminationChoices
          value={{ ...choicesOf(controller), ...doing.germination }}
          onChange={change => onDoing({ ...doing, germination: { ...doing.germination, ...change } })}
          humidifier={humidifier}
          humidity={GERMINATION_HUMIDITY}
          disabled={apply.isPending}
        />
      ) : null}

      <Refused error={apply.error} />

      {stage && !applied ? (
        <button
          type="button"
          className={`${ui.button} ${styles.aside}`}
          disabled={apply.isPending || spaceId === null}
          onClick={() => apply.mutate(presetBodyOf(stage, doing), { onSuccess: result => onDoing({ ...doing, chosen: stage, applied: result }) })}
        >
          {apply.isPending ? t('claim.doing.applying') : t('claim.doing.apply', { stage: stageChoiceName(t, stage) })}
        </button>
      ) : null}

      {applied ? (
        <ul className={ui.effects}>
          <li>{wroteLine}</li>
          {wrote && window ? <li>{t('claim.doing.window', { light: window })}</li> : null}
          <li>{phaseLine}</li>
        </ul>
      ) : null}
    </>
  );
}

/**
 * "Licht an 08:00–02:00 · 18 Std": the light window a stage puts the place's
 * climate device on - the stage's hours from the hour the light comes on now,
 * which a preset never moves - or null where the stage sets no hours or
 * nothing here takes a climate.
 */
const useWindowOf = (spaceId: string | null, stage: GrowthStage | null): string | null => {
  const { t } = useTranslation();
  const zone = useZone();
  const devices = useDevices();
  const hours = stage ? (climatePreset(stage, null)?.lightHours ?? null) : null;
  const device = devices.data?.items.find(
    one => one.spaceId === spaceId && one.configuration && statesTargets(one.configuration) && one.type !== 'fan',
  );
  if (hours === null || !device?.configuration) return null;
  return scheduleTitle(t, { lightsOn: draftOf(device.configuration).lightsOn, lightHours: hours }, offsetOf(serverNow(), zone));
};
