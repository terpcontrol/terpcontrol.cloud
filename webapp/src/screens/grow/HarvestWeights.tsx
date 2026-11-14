import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGrowPlants } from '@/api/grows';
import { useWeighAgain, type Weighed } from '@/api/lifecycle';
import { useLog } from '@/log/log-context';
import { looseFigure, typedFigure } from '@/ui/figures';
import { Refused } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import { Block } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { calendarDay, useZone } from '@/ui/zone';
import { namesOf, shareNote, weightLine, weightRefusal, weightsOf, type Weights } from './harvest';
import { Weight } from './HarvestSheet';
import styles from './Lifecycle.module.css';

/**
 * A harvest's weights, added or corrected after the cut: the dry weight comes days later, and a figure typed wrongly
 * is put right. Opened from a harvested plant's page and from the harvest's line wherever the diary is read. What is
 * corrected is the line - the totals as the scale said them, the yield every page states - and its plants take their
 * shares of it again; a plant that no line names, a harvest from before the lines, carries its own.
 */
export function HarvestWeights({ about, onClose }: { about: Weighed; onClose: () => void }) {
  const { t } = useTranslation();
  const zone = useZone();
  const { tell } = useLog();
  const weigh = useWeighAgain();
  const line = 'line' in about ? about.line : null;
  const plant = 'plant' in about ? about.plant : null;
  const growId = line?.growId ?? plant!.growId;
  const plants = useGrowPlants(growId).data?.items ?? [];

  const before: Weights = line ? weightsOf(line) : { wetWeightG: plant!.harvest?.wetWeightG ?? null, dryWeightG: plant!.harvest?.dryWeightG ?? null };
  const shown = (grams: number | null) => (grams === null ? '' : looseFigure(grams));
  const [wet, setWet] = useState(shown(before.wetWeightG));
  const [dry, setDry] = useState(shown(before.dryWeightG));

  const named = line ? namesOf(line, plants) : plant!.label;
  const count = line ? line.plantIds.length : 1;
  const cutAt = line?.occurredAt ?? plant!.harvest?.harvestedAt ?? null;
  const after: Weights = { wetWeightG: typedFigure(wet), dryWeightG: typedFigure(dry) };
  const refusals = [
    { label: t('grow.lifecycle.harvest.wet'), why: weightRefusal(wet) },
    { label: t('grow.lifecycle.harvest.dry'), why: weightRefusal(dry) },
  ];
  const refused = refusals.find(one => one.why !== null) ?? null;
  const refusal = useId();
  const share = count > 1 ? shareNote(t, count, after.wetWeightG, after.dryWeightG) : '';
  const unchanged = after.wetWeightG === before.wetWeightG && after.dryWeightG === before.dryWeightG;
  const said = (weights: Weights) => t('grow.lifecycle.weigh.said', { plants: named, weights: weightLine(t, weights) });

  const save = () =>
    weigh.mutate(
      { about, weights: after },
      {
        onSuccess: () => {
          onClose();
          tell({
            label: t('grow.lifecycle.weigh.saved', { what: said(after) }),
            undo: () => weigh.mutateAsync({ about, weights: before }),
            undone: said(before),
          });
        },
      },
    );

  return (
    <Sheet title={t('grow.lifecycle.weigh.title')} onClose={onClose}>
      <div className={ui.sheetBody}>
        <p className={ui.note}>
          {[named, cutAt ? t('grow.lifecycle.weigh.cutOn', { date: calendarDay(cutAt, zone) }) : null].filter(Boolean).join(' · ')}
        </p>
        <Block label={t('grow.lifecycle.harvest.weights')} help="harvestWeights" aside={t('grow.lifecycle.harvest.grams')}>
          <div className={ui.halves}>
            <Weight label={refusals[0].label} value={wet} onChange={setWet} refusal={refusals[0].why ? refusal : null} />
            <Weight label={refusals[1].label} value={dry} onChange={setDry} refusal={refusals[1].why ? refusal : null} />
          </div>
          {refused ? (
            <p id={refusal} className={ui.problem} role="alert">
              {t(refused.why === 'number' ? 'log.readingNoNumber' : 'grow.lifecycle.harvest.belowZero', { name: refused.label })}
            </p>
          ) : null}
          {share ? <p className={ui.note}>{share}</p> : null}
        </Block>
        <Refused error={weigh.error} />
        <button
          type="button"
          className={`${ui.button} ${ui.primary} ${styles.submit}`}
          disabled={weigh.isPending || refused !== null || unchanged}
          aria-describedby={refused ? refusal : undefined}
          onClick={save}
        >
          {weigh.isPending ? t('grow.lifecycle.saving') : t('grow.lifecycle.weigh.save')}
        </button>
      </div>
    </Sheet>
  );
}
