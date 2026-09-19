import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGrows } from '@/api/grows';
import { useMoveGrowHere } from '@/api/lifecycle';
import { Sheet } from '@/log/Sheet';
import { instantOf } from '@/ui/age';
import { Refused } from '@/ui/PageState';
import { Block, Choice, Choices, WhenField } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import styles from './PresetSheet.module.css';

/**
 * A grow moved in here, asked from the tent's side.
 *
 * It is the same move the grow page makes and the same row it appends; what
 * differs is which half of it is already known. Standing in the tent, the place
 * is given and the grow is the question, so that is what this asks - and the
 * grows already standing here are not among the answers, because a move to
 * where the plants already are is not a move.
 */
export function MoveHereSheet({ spaceId, spaceName, onClose }: { spaceId: string; spaceName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const grows = useGrows();
  const move = useMoveGrowHere(spaceId);

  const [growId, setGrowId] = useState<string | null>(null);
  const [at, setAt] = useState(() => new Date());

  const movable = (grows.data?.items ?? []).filter(grow => grow.endedAt === null && !grow.summary.locations.some(one => one.spaceId === spaceId));

  return (
    <Sheet title={t('space.moveHereTitle', { name: spaceName })} onClose={onClose}>
      <div className={styles.body}>
        <Block label={t('space.presets.whichGrow')}>
          {grows.isPending ? (
            <p className={ui.note}>{t('home.waiting')}</p>
          ) : movable.length === 0 ? (
            <p className={ui.note}>{t('space.presets.noGrowToMove')}</p>
          ) : (
            <Choices label={t('space.presets.whichGrow')}>
              {movable.map(grow => (
                <Choice key={grow.id} chosen={growId === grow.id} onChoose={() => setGrowId(grow.id)}>
                  {grow.name}
                </Choice>
              ))}
            </Choices>
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
            growId === null ? undefined : move.mutate({ growId, startedAt: instantOf(DateTime.fromJSDate(at)) }, { onSuccess: () => onClose() })
          }
        >
          {move.isPending ? t('grow.lifecycle.saving') : t('grow.lifecycle.move.submit', { place: spaceName })}
        </button>
      </div>
    </Sheet>
  );
}
