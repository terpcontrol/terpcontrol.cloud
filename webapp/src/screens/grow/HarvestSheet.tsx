import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, HarvestResult, Plant } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useUpdateGrow } from '@/api/grows';
import { useHarvest } from '@/api/lifecycle';
import { Sheet } from '@/log/Sheet';
import { instantOf } from '@/ui/age';
import { readingFigure } from '@/ui/entries';
import { Refused } from '@/ui/PageState';
import { Block, WhenField } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { calendarDay, DAY, useZone } from '@/ui/zone';
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
 *
 * A grow whose record carries no plants is the third case and not the second.
 * "Every plant has already come down" is drawn from an empty list of standing
 * plants, and a migrated grow has an empty list because it never had plants at
 * all - so a grow in its fourth week of flower was being told its harvest was
 * over. It is also the one sheet that can end a grow, because the server ends
 * one when its last plant is cut, so saying the false thing here left those
 * grows with no way to be finished anywhere in the app. Such a grow therefore
 * says what its Plants tab says, and is offered the end itself: a date and the
 * grow's `endedAt`, which is what a harvest would have written anyway.
 */
/** Which plants the sheet opens on, for a caller that is already about one of them; the grow page names none and the scope is the grow's. */
export function HarvestSheet({
  grow,
  plants,
  preselect,
  onClose,
}: {
  grow: GrowListItem;
  plants: Plant[];
  preselect?: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const harvest = useHarvest(grow.id);

  const [chosen, setChosen] = useState<string[] | null>(preselect ?? null);
  // Now as the server reckons it, which is the clock the day field's cap is on.
  const [at, setAt] = useState(() => serverNow().toJSDate());
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
        {plants.length === 0 ? (
          <NothingPlanted grow={grow} onClose={onClose} />
        ) : standing.length === 0 ? (
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
            {t('grow.lifecycle.harvest.endsTheGrow', { date: DateTime.fromJSDate(at).toFormat(DAY) })}
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
                      {plant.harvest ? calendarDay(plant.harvest.harvestedAt, zone) : ''} · {weightLine(t, plant)}
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

/**
 * The sheet over a grow whose record holds no plants: everything brought over
 * from the old app, which kept no plant list, and anything started without one.
 *
 * There is nothing to cut down and nothing to weigh, so the sheet offers the
 * only thing that is left of a harvest for such a grow - the day it came down.
 * That goes through the grow itself rather than through a harvest, because the
 * server refuses a harvest of nothing and would only answer 409; `endedAt` is
 * the same field the last plant's harvest would have set, and the day counter
 * stops on it either way.
 *
 * A grow that has already been ended is told when, rather than offered the
 * button a second time. Nothing here can take an end back, which is why the
 * date is asked for before it is written rather than corrected afterwards.
 */
function NothingPlanted({ grow, onClose }: { grow: GrowListItem; onClose: () => void }) {
  const { t } = useTranslation();
  const zone = useZone();
  const update = useUpdateGrow(grow.id);
  const [at, setAt] = useState(() => serverNow().toJSDate());

  return (
    <>
      <p className={ui.note}>{t('grow.lifecycle.harvest.noPlantsRecorded')}</p>

      {grow.endedAt !== null ? (
        <p className={ui.note}>{t('grow.lifecycle.harvest.alreadyEnded', { date: calendarDay(grow.endedAt, zone) })}</p>
      ) : (
        <Block label={t('grow.lifecycle.harvest.endInstead')}>
          <WhenField label={t('grow.lifecycle.when')} at={at} onChange={setAt} />
          <p className={ui.note}>{t('grow.lifecycle.harvest.endNote')}</p>
          <Refused error={update.error} />
          <button
            type="button"
            className={`${ui.button} ${ui.primary} ${styles.submit}`}
            disabled={update.isPending}
            onClick={() => update.mutate({ endedAt: instantOf(DateTime.fromJSDate(at)) }, { onSuccess: () => onClose() })}
          >
            {update.isPending ? t('grow.lifecycle.saving') : t('grow.lifecycle.harvest.endTheGrow')}
          </button>
        </Block>
      )}
    </>
  );
}

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
