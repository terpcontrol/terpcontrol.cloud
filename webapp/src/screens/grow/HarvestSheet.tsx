import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, HarvestResult, Plant } from '@fg2/shared-types/v1';
import { useHarvest } from '@/api/lifecycle';
import { Sheet } from '@/log/Sheet';
import { instantOf } from '@/ui/age';
import { readingFigure } from '@/ui/entries';
import { Refused } from '@/ui/PageState';
import { Block, WhenField } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { PlantPicker } from './PlantPicker';
import styles from './Lifecycle.module.css';

/**
 * Cutting plants down, all at once or a few at a time.
 *
 * The two weights are totals for what came down together, because that is what
 * a scale says; the model keeps a weight per plant so that a staggered harvest
 * adds up instead of being counted twice, so the server shares the total out
 * over the plants named. The sheet says so beforehand and shows what each plant
 * ended up with afterwards, since that share is the server's arithmetic and not
 * something the sheet should be trusted to have guessed.
 *
 * The last plant to come down ends the grow, on the day of the harvest rather
 * than the day it was typed in. That is the one thing here that cannot be taken
 * back with another tap, so the sheet says it in the note and again on the
 * button before either is pressed.
 */
export function HarvestSheet({ grow, plants, onClose }: { grow: GrowListItem; plants: Plant[]; onClose: () => void }) {
  const { t } = useTranslation();
  const harvest = useHarvest(grow.id);

  const [chosen, setChosen] = useState<string[] | null>(null);
  const [at, setAt] = useState(() => new Date());
  const [wet, setWet] = useState('');
  const [dry, setDry] = useState('');
  const [done, setDone] = useState<HarvestResult | null>(null);

  const standing = plants.filter(plant => plant.status === 'active' && plant.harvest === null);
  const alreadyDown = plants.filter(plant => plant.harvest !== null);
  const cut = chosen === null ? standing : standing.filter(plant => chosen.includes(plant.id));
  // The server's own rule for the grow ending, read the same way round: every
  // plant is either coming down now or was never standing.
  const endsTheGrow =
    grow.endedAt === null && cut.length > 0 && plants.every(plant => cut.some(one => one.id === plant.id) || plant.status !== 'active');

  const body = {
    plantIds: chosen,
    harvestedAt: instantOf(DateTime.fromJSDate(at)),
    wetWeightG: gramsOf(wet),
    dryWeightG: gramsOf(dry),
  };

  return (
    <Sheet title={t('grow.lifecycle.harvest.title', { name: grow.name })} onClose={onClose}>
      <div className={styles.body}>
        {standing.length === 0 ? (
          <p className={ui.note}>{t('grow.lifecycle.harvest.nothingStanding')}</p>
        ) : (
          <Block
            label={t('grow.lifecycle.harvest.whatComesDown')}
            aside={<span className="mono">{t('grow.lifecycle.harvest.standing', { count: standing.length })}</span>}
          >
            <PlantPicker
              plants={plants}
              chosen={chosen}
              everyLabel={t('grow.lifecycle.harvest.everythingStanding')}
              label={t('grow.lifecycle.whichPlants')}
              unavailable={alreadyDown.map(plant => plant.id)}
              onChange={setChosen}
            />
            <WhenField label={t('grow.lifecycle.when')} at={at} onChange={setAt} />
          </Block>
        )}

        {standing.length === 0 ? null : (
          <Block label={t('grow.lifecycle.harvest.weights')} aside={<span className="mono">{t('grow.lifecycle.harvest.grams')}</span>}>
            <div className={styles.weights}>
              <Weight label={t('grow.lifecycle.harvest.wet')} value={wet} onChange={setWet} />
              <Weight label={t('grow.lifecycle.harvest.dry')} value={dry} onChange={setDry} />
            </div>
            <p className={ui.note}>{shareNote(t, cut.length, body.wetWeightG, body.dryWeightG)}</p>
          </Block>
        )}

        {endsTheGrow ? (
          <p className={`${ui.cardDashed} ${styles.warning}`}>
            {t('grow.lifecycle.harvest.endsTheGrow', { date: DateTime.fromJSDate(at).toFormat('d LLL yyyy') })}
          </p>
        ) : null}

        <Refused error={harvest.error} />

        {standing.length === 0 ? null : (
          <button
            type="button"
            className={`${ui.button} ${ui.primary} ${styles.submit}`}
            disabled={harvest.isPending || cut.length === 0}
            onClick={() =>
              harvest.mutate(body, {
                onSuccess: result => {
                  setDone(result);
                  setChosen(null);
                  setWet('');
                  setDry('');
                },
              })
            }
          >
            {harvest.isPending
              ? t('grow.lifecycle.saving')
              : endsTheGrow
                ? t('grow.lifecycle.harvest.submitAndEnd', { count: cut.length })
                : t('grow.lifecycle.harvest.submit', { count: cut.length })}
          </button>
        )}

        {done ? (
          <Block label={t('grow.lifecycle.harvest.whatWasWritten')}>
            <ul className={styles.rows}>
              {done.plants.map(plant => (
                <li key={plant.id} className={styles.row}>
                  <div className={styles.rowHead}>
                    <span className={styles.rowTitle}>{plant.label}</span>
                    <span className={`mono ${styles.rowMeta}`}>{weightLine(t, plant)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {alreadyDown.length === 0 ? null : (
          <Block label={t('grow.lifecycle.harvest.alreadyDown')}>
            <ul className={styles.rows}>
              {alreadyDown.map(plant => (
                <li key={plant.id} className={styles.row} data-dim>
                  <div className={styles.rowHead}>
                    <span className={styles.rowTitle}>{plant.label}</span>
                    <span className={`mono ${styles.rowMeta}`}>
                      {plant.harvest ? DateTime.fromISO(plant.harvest.harvestedAt).toFormat('d LLL yyyy') : ''} · {weightLine(t, plant)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <p className={ui.note}>{t('grow.lifecycle.harvest.correctOnThePlant')}</p>
          </Block>
        )}
      </div>
    </Sheet>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function Weight({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className={`${ui.card} ${styles.weight}`}>
      <span className={styles.weightLabel}>{label}</span>
      <input
        className={`figure ${styles.weightInput}`}
        inputMode="decimal"
        placeholder="—"
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </label>
  );
}

/** What a scale said, as a number. An empty field is not a weight of nothing, so it stays null. */
const gramsOf = (typed: string): number | null => {
  const value = Number(typed.replace(',', '.').trim());
  return typed.trim() && Number.isFinite(value) ? value : null;
};

/** "300 g wet over 3 plants · 100 g each": what the server will do with the total, before it does it. */
const shareNote = (t: Translate, count: number, wet: number | null, dry: number | null): string => {
  if (count === 0) return t('grow.lifecycle.harvest.pickSomething');
  if (wet === null && dry === null) return t('grow.lifecycle.harvest.weightsOptional');

  const each = (total: number) => readingFigure(Math.round((total / count) * 100) / 100);
  const parts = [
    wet === null ? '' : t('grow.lifecycle.harvest.eachWet', { total: readingFigure(wet), each: each(wet), count }),
    dry === null ? '' : t('grow.lifecycle.harvest.eachDry', { total: readingFigure(dry), each: each(dry), count }),
  ];

  return parts.filter(Boolean).join(' · ');
};

const weightLine = (t: Translate, plant: Plant): string => {
  if (!plant.harvest) return '';
  const parts = [
    plant.harvest.wetWeightG === null ? '' : t('grow.report.wet', { grams: readingFigure(plant.harvest.wetWeightG) }),
    plant.harvest.dryWeightG === null ? '' : t('grow.report.dry', { grams: readingFigure(plant.harvest.dryWeightG) }),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : t('grow.lifecycle.harvest.noWeight');
};
