import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, Placement, Plant, Space } from '@fg2/shared-types/v1';
import { ApiError } from '@/api/problem';
import { useCorrectPlacement, useMovePlants, useWithdrawPlacement } from '@/api/lifecycle';
import { Sheet } from '@/log/Sheet';
import { instantOf } from '@/ui/age';
import { Refused } from '@/ui/PageState';
import { Block, Choice, Choices, WhenField } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { PlantPicker } from './PlantPicker';
import styles from './Lifecycle.module.css';

/**
 * Where the plants stand: moving them, taking them out of every tent, and
 * repairing a move that was recorded wrongly.
 *
 * "No fixed place" is a place a grow can be in rather than the absence of one,
 * which is why it sits in the same row as the tents. It is also what the server
 * insists on: a grow always answers where it is, so the last open placement
 * cannot be withdrawn - and that refusal is offered here as the move it really
 * asks for rather than as a sentence about a rule.
 */
export function MoveSheet({ grow, plants, spaces, onClose }: { grow: GrowListItem; plants: Plant[]; spaces: Space[]; onClose: () => void }) {
  const { t } = useTranslation();
  const move = useMovePlants(grow.id);

  const open = spaces.filter(space => space.archivedAt === null && space.kind !== 'room');
  const [spaceId, setSpaceId] = useState<string | null>(() => open.find(space => !standsIn(grow, space.id))?.id ?? null);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [at, setAt] = useState(() => new Date());
  const [row, setRow] = useState<{ placementId: string; as: 'correct' | 'withdraw' } | null>(null);

  const placements = [...grow.placements].sort((one, other) => other.startedAt.localeCompare(one.startedAt));

  return (
    <Sheet title={t('grow.lifecycle.move.title', { name: grow.name })} onClose={onClose}>
      <div className={styles.body}>
        <p className={`mono ${styles.now}`}>
          {t('grow.lifecycle.move.standsIn', {
            places: grow.summary.locations.map(location => placeName(t, spaces, location.spaceId)).join(' · ') || t('grow.noFixedPlace'),
          })}
        </p>

        <Block label={t('grow.lifecycle.move.moveTo')}>
          <Choices label={t('grow.lifecycle.move.moveTo')}>
            {open.map(space => (
              <Choice key={space.id} chosen={spaceId === space.id} onChoose={() => setSpaceId(space.id)}>
                {space.name}
              </Choice>
            ))}
            <Choice chosen={spaceId === null} onChoose={() => setSpaceId(null)}>
              {t('grow.noFixedPlace')}
            </Choice>
          </Choices>

          <PlantPicker
            plants={plants}
            chosen={chosen}
            everyLabel={t('grow.lifecycle.everyPlant')}
            label={t('grow.lifecycle.whichPlants')}
            onChange={setChosen}
          />
          <WhenField label={t('grow.lifecycle.when')} at={at} onChange={setAt} />

          <p className={ui.note}>{t(spaceId === null ? 'grow.lifecycle.move.nowhereNote' : 'grow.lifecycle.move.note')}</p>
          <Refused error={move.error} />

          <button
            type="button"
            className={`${ui.button} ${ui.primary} ${styles.submit}`}
            disabled={move.isPending}
            onClick={() => move.mutate({ spaceId, plantIds: chosen, startedAt: instantOf(DateTime.fromJSDate(at)) }, { onSuccess: () => onClose() })}
          >
            {move.isPending
              ? t('grow.lifecycle.saving')
              : t('grow.lifecycle.move.submit', { place: spaceId === null ? t('grow.noFixedPlace') : placeName(t, spaces, spaceId) })}
          </button>
        </Block>

        <Block label={t('grow.lifecycle.move.history')} aside={t('grow.lifecycle.move.newestFirst')}>
          <ul className={styles.rows}>
            {placements.map(placement => (
              <PlacementRow
                key={placement.id}
                grow={grow}
                placement={placement}
                spaces={spaces}
                open={row?.placementId === placement.id ? row.as : null}
                onOpen={as => setRow(as === null ? null : { placementId: placement.id, as })}
              />
            ))}
          </ul>
        </Block>
      </div>
    </Sheet>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const placeName = (t: Translate, spaces: Space[], spaceId: string | null): string =>
  spaceId === null ? t('grow.noFixedPlace') : (spaces.find(space => space.id === spaceId)?.name ?? '…');

const standsIn = (grow: GrowListItem, spaceId: string): boolean => grow.summary.locations.some(location => location.spaceId === spaceId);

/** One row of where the plants have been: the place, the stretch, and how much of the grow it covers. */
function PlacementRow({
  grow,
  placement,
  spaces,
  open,
  onOpen,
}: {
  grow: GrowListItem;
  placement: Placement;
  spaces: Space[];
  open: 'correct' | 'withdraw' | null;
  onOpen: (as: 'correct' | 'withdraw' | null) => void;
}) {
  const { t } = useTranslation();
  const day = (at: string) => DateTime.fromISO(at).toFormat('d LLL yyyy');

  return (
    <li className={styles.row} data-dim={placement.endedAt !== null}>
      <div className={styles.rowHead}>
        <span className={styles.rowTitle}>{placeName(t, spaces, placement.spaceId)}</span>
        <span className={`mono ${styles.rowMeta}`}>
          {day(placement.startedAt)} → {placement.endedAt ? day(placement.endedAt) : t('grow.lifecycle.move.stillThere')}
          {placement.plantIds === null ? '' : ` · ${t('grow.lifecycle.somePlants', { count: placement.plantIds.length })}`}
        </span>
      </div>

      {open === null ? (
        <div className={styles.rowActions}>
          <button type="button" className={ui.chip} onClick={() => onOpen('correct')}>
            {t('grow.lifecycle.move.correct')}
          </button>
          <button type="button" className={`${ui.chip} ${styles.danger}`} onClick={() => onOpen('withdraw')}>
            {t('grow.lifecycle.move.withdraw')}
          </button>
        </div>
      ) : open === 'correct' ? (
        <PlacementEditor grow={grow} placement={placement} spaces={spaces} onDone={() => onOpen(null)} />
      ) : (
        <PlacementWithdrawal grow={grow} placement={placement} onDone={() => onOpen(null)} />
      )}
    </li>
  );
}

/** A move recorded wrongly - the wrong tent, the wrong day - and the way a placement left open is closed on the day the plants really left. */
function PlacementEditor({ grow, placement, spaces, onDone }: { grow: GrowListItem; placement: Placement; spaces: Space[]; onDone: () => void }) {
  const { t } = useTranslation();
  const correct = useCorrectPlacement(grow.id);

  const [spaceId, setSpaceId] = useState(placement.spaceId);
  const [from, setFrom] = useState(() => new Date(placement.startedAt));
  const [until, setUntil] = useState(() => new Date(placement.endedAt ?? placement.startedAt));
  const [stillThere, setStillThere] = useState(placement.endedAt === null);

  const body = {
    spaceId,
    startedAt: instantOf(DateTime.fromJSDate(from)),
    endedAt: stillThere ? null : instantOf(DateTime.fromJSDate(until)),
  };
  const changed = body.spaceId !== placement.spaceId || body.startedAt !== placement.startedAt || body.endedAt !== placement.endedAt;

  return (
    <div className={styles.editor}>
      <Choices label={t('grow.lifecycle.move.moveTo')}>
        {spaces
          .filter(space => space.archivedAt === null && space.kind !== 'room')
          .map(space => (
            <Choice key={space.id} chosen={spaceId === space.id} onChoose={() => setSpaceId(space.id)}>
              {space.name}
            </Choice>
          ))}
        <Choice chosen={spaceId === null} onChoose={() => setSpaceId(null)}>
          {t('grow.noFixedPlace')}
        </Choice>
      </Choices>

      <WhenField label={t('grow.lifecycle.move.from')} at={from} onChange={setFrom} />

      <Choices label={t('grow.lifecycle.move.until')}>
        <Choice chosen={stillThere} onChoose={() => setStillThere(true)}>
          {t('grow.lifecycle.move.stillThere')}
        </Choice>
        <Choice chosen={!stillThere} onChoose={() => setStillThere(false)}>
          {t('grow.lifecycle.move.leftOn')}
        </Choice>
      </Choices>
      {stillThere ? null : <WhenField label={t('grow.lifecycle.move.until')} at={until} onChange={setUntil} />}

      <p className={ui.note}>{t('grow.lifecycle.move.correctionNote')}</p>
      <Refused error={correct.error} />

      <div className={styles.rowActions}>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={correct.isPending || !changed}
          onClick={() => correct.mutate({ placementId: placement.id, body }, { onSuccess: onDone })}
        >
          {correct.isPending ? t('grow.lifecycle.saving') : t('grow.lifecycle.move.saveCorrection')}
        </button>
        <button type="button" className={ui.button} onClick={onDone}>
          {t('grow.lifecycle.cancel')}
        </button>
      </div>
    </div>
  );
}

/**
 * A move that never happened.
 *
 * The one refusal this round has to make a person able to act on lives here: a
 * grow always answers where it is, so the row that says so is not the one to
 * remove. The way out is the move nobody has made yet, so it is offered as that
 * move - "put the grow nowhere, then take this row out" - rather than as the
 * rule it broke.
 */
function PlacementWithdrawal({ grow, placement, onDone }: { grow: GrowListItem; placement: Placement; onDone: () => void }) {
  const { t } = useTranslation();
  const withdraw = useWithdrawPlacement(grow.id);
  const move = useMovePlants(grow.id);

  const standsNowhere = withdraw.error instanceof ApiError && withdraw.error.problem.code === 'grow_stands_nowhere';

  /** The escape the refusal asks for: somewhere to stand, and then the row that never happened is free to go. */
  const rescue = () =>
    move.mutate(
      { spaceId: null, plantIds: placement.plantIds, startedAt: instantOf(DateTime.now()) },
      { onSuccess: () => withdraw.mutate(placement.id, { onSuccess: onDone }) },
    );

  return (
    <div className={styles.editor}>
      <ul className={styles.effect}>
        <li>{t('grow.lifecycle.move.withdrawEffect')}</li>
        <li>{t('grow.lifecycle.phase.effect.entryGone')}</li>
      </ul>

      <Refused error={withdraw.error} />
      <Refused error={move.error} />

      <div className={styles.rowActions}>
        {standsNowhere ? (
          <button type="button" className={`${ui.button} ${ui.primary}`} disabled={move.isPending || withdraw.isPending} onClick={rescue}>
            {move.isPending || withdraw.isPending ? t('grow.lifecycle.saving') : t('grow.lifecycle.move.nowhereThenWithdraw')}
          </button>
        ) : (
          <button
            type="button"
            className={`${ui.button} ${styles.dangerButton}`}
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate(placement.id, { onSuccess: onDone })}
          >
            {withdraw.isPending ? t('grow.lifecycle.saving') : t('grow.lifecycle.move.confirmWithdraw')}
          </button>
        )}
        <button type="button" className={ui.button} onClick={onDone}>
          {t('grow.lifecycle.cancel')}
        </button>
      </div>
    </div>
  );
}
