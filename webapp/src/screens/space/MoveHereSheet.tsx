import { DateTime } from 'luxon';
import { useState } from 'react';
import type { GrowListItem } from '@fg2/shared-types/v1';
import { useTranslation } from 'react-i18next';
import { serverNow } from '@/api/clock';
import { useMoveGrowHere } from '@/api/lifecycle';
import { useSpaces } from '@/api/spaces';
import { useLog } from '@/log/log-context';
import { StartGrowSheet } from '@/screens/grow/new/WhatGrows';
import { Sheet } from '@/ui/Sheet';
import { instantOf } from '@/ui/age';
import { Refused } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import { Block, Choice, Choices, WhenField } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useMovableGrows } from './movable-grows';
import styles from './MoveHereSheet.module.css';

/**
 * A grow moved in here, asked from the tent's side.
 *
 * It is the same move the grow page makes and the same row it appends; what
 * differs is which half of it is already known. Standing in the tent, the place
 * is given and the grow is the question, so that is what this asks - and the
 * grows already standing here are not among the answers, because a move to
 * where the plants already are is not a move.
 *
 * Every chip says where its grow stands now, because that is the whole of what
 * a move costs: the one on offer may be day 35 of a flowering run in another
 * tent, with a plan and a set of alarm rules that follow it. A grow standing
 * nowhere in particular says that instead of nothing. Choosing is not
 * committing: the pick is spent by the button, so a mis-tap on a list of names
 * cannot take a running grow out of the tent it is in.
 *
 * A tent with nothing to move into it is a tent waiting for its first grow, so
 * that is what it is offered: the new-grow sheet takes this one's place with
 * the tent already answered.
 */
export function MoveHereSheet({
  spaceId,
  spaceName,
  chosen = null,
  onClose,
}: {
  spaceId: string;
  spaceName: string;
  /** The grow the sheet stands on before anything is picked: the one the tap that opened it named. */
  chosen?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const movable = useMovableGrows(spaceId);
  const move = useMoveGrowHere(spaceId);
  const mayManage = useMayManage(spaceId);
  const spaces = useSpaces();
  const { tell } = useLog();

  const [picked, setGrowId] = useState<string | null>(chosen);
  const [at, setAt] = useState(() => serverNow().toJSDate());
  const [starting, setStarting] = useState(false);

  if (starting) return <StartGrowSheet spaceId={spaceId} name={spaceName} onClose={onClose} />;

  // The only grow that could come stands chosen: there is nothing to pick among one.
  const growId = picked ?? (movable.items.length === 1 ? movable.items[0].id : null);

  const standing = (grow: GrowListItem): string | null => {
    const open = grow.placements.find(one => one.endedAt === null);
    if (!open) return null;
    if (open.spaceId === null) return t('space.presets.growStandsNowhere');

    return spaces.data?.items.find(one => one.id === open.spaceId)?.name ?? null;
  };

  return (
    <Sheet title={t('space.moveHereTitle', { name: spaceName })} onClose={onClose}>
      <div className={ui.sheetBody}>
        <Block label={t('space.presets.whichGrow')}>
          {movable.pending ? (
            <p className={ui.note}>{t('home.waiting')}</p>
          ) : movable.items.length === 0 ? (
            <>
              <p className={ui.note}>{t('space.presets.noGrowToMove')}</p>
              {mayManage ? (
                <button type="button" className={ui.button} onClick={() => setStarting(true)}>
                  {t('space.presets.startGrowHere')}
                </button>
              ) : null}
            </>
          ) : (
            <div className={styles.list}>
              <Choices label={t('space.presets.whichGrow')}>
                {movable.items.map(grow => {
                  const place = standing(grow);

                  return (
                    <Choice key={grow.id} chosen={growId === grow.id} onChoose={() => setGrowId(grow.id)}>
                      {place === null ? grow.name : t('space.presets.growAt', { name: grow.name, place })}
                    </Choice>
                  );
                })}
              </Choices>
            </div>
          )}
        </Block>

        <WhenField label={t('grow.lifecycle.when')} at={at} onChange={setAt} />

        <p className={ui.note}>{t('grow.lifecycle.move.note')}</p>
        <Refused error={move.error} />

        <button
          type="button"
          className={`${ui.button} ${ui.primary} ${styles.submit}`}
          disabled={move.isPending || growId === null}
          onClick={() =>
            growId === null
              ? undefined
              : move.mutate(
                  { growId, startedAt: instantOf(DateTime.fromJSDate(at)) },
                  {
                    onSuccess: () => {
                      onClose();
                      const name = movable.items.find(one => one.id === growId)?.name ?? '';
                      tell({ label: t('grow.told.moved', { place: spaceName, name }), undo: null });
                    },
                  },
                )
          }
        >
          {move.isPending ? t('grow.lifecycle.saving') : t('grow.lifecycle.move.submit', { place: spaceName })}
        </button>
      </div>
    </Sheet>
  );
}
