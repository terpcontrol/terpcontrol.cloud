import { DateTime } from 'luxon';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { GrowListItem, HarvestResult, Plant } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useUpdateGrow } from '@/api/grows';
import { useHarvest, useTakeHarvestBack } from '@/api/lifecycle';
import type { Translate } from '@/i18n/i18n';
import { useLog } from '@/log/log-context';
import { Sheet } from '@/ui/Sheet';
import { instantOf } from '@/ui/age';
import { looseFigure, typedFigure } from '@/ui/figures';
import { Help } from '@/ui/Help';
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
  const takeBack = useTakeHarvestBack();
  const { tell } = useLog();

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

  const ended = useGrowEnded(grow, onClose);

  const body = {
    plantIds: chosen,
    harvestedAt: instantOf(DateTime.fromJSDate(at)),
    wetWeightG: typedFigure(wet),
    dryWeightG: typedFigure(dry),
  };

  const share = shareNote(t, cut.length, body.wetWeightG, body.dryWeightG);
  // A weight the sheet cannot read is said by its field's name and holds the harvest back: sent as nothing, "abc" was a
  // weight lost without a word.
  const refusals = [
    { label: t('grow.lifecycle.harvest.wet'), why: weightRefusal(wet) },
    { label: t('grow.lifecycle.harvest.dry'), why: weightRefusal(dry) },
  ];
  const refused = refusals.find(one => one.why !== null) ?? null;
  const refusal = useId();

  return (
    <Sheet title={t('grow.lifecycle.harvest.title', { name: grow.name })} onClose={onClose}>
      <div className={ui.sheetBody}>
        {plants.length === 0 ? (
          <NothingPlanted grow={grow} onClose={onClose} />
        ) : standing.length === 0 ? (
          <p className={ui.note}>{t('grow.lifecycle.harvest.nothingStanding')}</p>
        ) : (
          <Block label={t('grow.lifecycle.harvest.whatComesDown')} aside={t('grow.lifecycle.harvest.standing', { count: standing.length })}>
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
            {/* What a typed weight comes to per plant; that both may stay empty is behind the help. */}
            {share ? <p className={ui.note}>{share}</p> : null}
          </Block>
        )}

        {endsTheGrow ? (
          <p className={`${ui.cardDashed} ${styles.warning}`}>
            {t('grow.lifecycle.harvest.endsTheGrow', { date: DateTime.fromJSDate(at).toFormat(DAY) })}
            <Help topic="growEnds" />
          </p>
        ) : null}

        <Refused error={harvest.error} />

        {standing.length === 0 ? null : (
          <button
            type="button"
            className={`${ui.button} ${ui.primary} ${styles.submit}`}
            disabled={harvest.isPending || cut.length === 0 || refused !== null}
            aria-describedby={refused ? refusal : undefined}
            onClick={() =>
              harvest.mutate(body, {
                onSuccess: result => {
                  // The last plants down end the grow: its page is its report now, and the toast says why it moved.
                  if (endsTheGrow) return ended();
                  const named = { plants: result.plants.map(plant => plant.label).join(', '), count: result.plants.length };
                  tell({
                    label: t('grow.lifecycle.harvest.told', named),
                    // Taken back, what the sheet said was written is not written any more.
                    undo: () => takeBack.mutateAsync(result).then(() => setDone(null)),
                    undone: t('grow.lifecycle.harvest.standingAgain', named),
                  });
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
            <ul className={ui.list}>
              {done.plants.map(plant => (
                <li key={plant.id} className={styles.row}>
                  <div className={ui.headRow}>
                    <span className={styles.rowTitle}>{plant.label}</span>
                    <span className={styles.rowMeta}>{weightLine(t, plant)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {alreadyDown.length === 0 ? null : (
          <Block label={t('grow.lifecycle.harvest.alreadyDown')}>
            <ul className={ui.list}>
              {alreadyDown.map(plant => (
                <li key={plant.id} className={styles.row} data-dim>
                  <div className={ui.headRow}>
                    <span className={styles.rowTitle}>{plant.label}</span>
                    <span className={styles.rowMeta}>
                      {plant.harvest ? calendarDay(plant.harvest.harvestedAt, zone) : ''} · {weightLine(t, plant)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Block>
        )}
      </div>
    </Sheet>
  );
}

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
  const ended = useGrowEnded(grow, onClose);
  const zone = useZone();
  const update = useUpdateGrow(grow.id);
  const [at, setAt] = useState(() => serverNow().toJSDate());

  return (
    <>
      <p className={ui.note}>{t('grow.lifecycle.harvest.noPlantsRecorded')}</p>

      {grow.endedAt !== null ? (
        <p className={ui.note}>{t('grow.lifecycle.harvest.alreadyEnded', { date: calendarDay(grow.endedAt, zone) })}</p>
      ) : (
        <Block label={t('grow.lifecycle.harvest.endInstead')} help="growEnds">
          <WhenField label={t('grow.lifecycle.when')} at={at} onChange={setAt} />
          <Refused error={update.error} />
          <button
            type="button"
            className={`${ui.button} ${ui.primary} ${styles.submit}`}
            disabled={update.isPending}
            onClick={() => update.mutate({ endedAt: instantOf(DateTime.fromJSDate(at)) }, { onSuccess: ended })}
          >
            {update.isPending ? t('grow.lifecycle.saving') : t('grow.lifecycle.harvest.endTheGrow')}
          </button>
        </Block>
      )}
    </>
  );
}

function Weight({
  label,
  value,
  onChange,
  refusal,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The sentence that refuses what was typed here, where there is one. */
  refusal: string | null;
}) {
  return (
    <label className={`${ui.card} ${styles.weight}`}>
      <span className={styles.weightLabel}>{label}</span>
      <input
        className={`figure ${styles.weightInput}`}
        inputMode="decimal"
        placeholder="—"
        aria-invalid={refusal !== null || undefined}
        aria-describedby={refusal ?? undefined}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </label>
  );
}

/** Why a typed weight cannot be sent, or null where it can: nothing typed is no weight, which is allowed. */
const weightRefusal = (typed: string): 'number' | 'negative' | null => {
  if (typed.trim() === '') return null;
  const value = typedFigure(typed);
  return value === null ? 'number' : value < 0 ? 'negative' : null;
};

/** "300 g wet over 3 plants · 100 g each": what the server will do with the total, before it does it. */
const shareNote = (t: Translate, count: number, wet: number | null, dry: number | null): string => {
  if (count === 0) return t('grow.lifecycle.harvest.pickSomething');
  if (wet === null && dry === null) return '';

  const each = (total: number) => looseFigure(Math.round((total / count) * 100) / 100);
  const parts = [
    wet === null ? '' : t('grow.lifecycle.harvest.eachWet', { total: looseFigure(wet), each: each(wet), count }),
    dry === null ? '' : t('grow.lifecycle.harvest.eachDry', { total: looseFigure(dry), each: each(dry), count }),
  ];

  return parts.filter(Boolean).join(' · ');
};

const weightLine = (t: Translate, plant: Plant): string => {
  if (!plant.harvest) return '';
  const parts = [
    plant.harvest.wetWeightG === null ? '' : t('grow.report.wet', { grams: looseFigure(plant.harvest.wetWeightG) }),
    plant.harvest.dryWeightG === null ? '' : t('grow.report.dry', { grams: looseFigure(plant.harvest.dryWeightG) }),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : t('grow.lifecycle.harvest.noWeight');
};

/**
 * What ending a grow leads to: the sheet closes onto the grow's report - Grow
 * shows what runs, and this one no longer does - and a toast says that it has
 * ended. Nothing takes an end back, so the toast offers no undo.
 */
const useGrowEnded = (grow: GrowListItem, onClose: () => void) => {
  const { t } = useTranslation();
  const { tell } = useLog();
  const navigate = useNavigate();

  return () => {
    onClose();
    void navigate(`/grows/${grow.id}/report`);
    tell({ label: t('grow.lifecycle.harvest.ended', { name: grow.name }), undo: null });
  };
};
