import { X } from 'lucide-react';
import { useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, GrowthStage, Space } from '@fg2/shared-types/v1';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { useSpaceOverview } from '@/api/spaces';
import { typeName } from '@/ui/naming';
import ui from '@/ui/ui.module.css';
import { WhatGrows } from '@/screens/grow/new/WhatGrows';
import { MoveHereSheet } from '@/screens/space/MoveHereSheet';
import { useMovableGrows } from '@/screens/space/movable-grows';
import { shownStill } from '@/screens/start/place';
import styles from './Claim.module.css';

/**
 * The last question of setting a device up: what grows here. It is a page of
 * its own rather than one more row of the list, because it is the one answer
 * that turns a regulated tent into a diary: an answer starts the grow, and
 * Start then leads with it. "Jetzt nicht" leaves the question on Start as a
 * card. Somebody whose grow already runs elsewhere moves it here instead.
 *
 * Where a camera already delivers, its newest picture heads the page: it is
 * what the diary will be made of.
 */
export function GrowStep({
  device,
  space,
  stage,
  step,
  of,
  headingRef,
  onLeave,
}: {
  device: Device;
  space: Space;
  /** The stage the place was put on a step earlier, which the plants are most likely in. */
  stage: GrowthStage | null;
  step: number;
  of: number;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const overview = useSpaceOverview(space.id).data;
  const still = overview?.cameras.map(shownStill).find(one => one !== null) ?? null;
  const movable = useMovableGrows(space.id);
  const [moving, setMoving] = useState(false);

  return (
    <section className={styles.screen}>
      <header className={styles.growHead}>
        <button type="button" className={styles.close} aria-label={t('claim.grow.close')} onClick={onLeave}>
          <X size={22} strokeWidth={2} aria-hidden />
        </button>
        <span className={styles.growProgress}>
          <span>{t('claim.grow.step', { device: typeName(device.type, t), step, of })}</span>
          <span className={styles.growBar} aria-hidden />
        </span>
      </header>
      {still ? (
        <img
          className={styles.growPicture}
          src={mediaUrl(still.mediaId, THUMBNAIL_WIDTH.frame) ?? undefined}
          alt={t('home.card.stillAlt', { name: space.name })}
        />
      ) : null}
      <h1 ref={headingRef} tabIndex={-1} className={styles.growTitle}>
        {t('start.grow.title', { name: space.name })}
      </h1>
      <p className={styles.growText}>{t(still ? 'start.grow.textPictured' : 'start.grow.text')}</p>
      <WhatGrows spaceId={space.id} stage={stage} onStarted={onLeave} submitClass={`${ui.button} ${ui.primary} ${styles.growStart}`} />
      {movable.items.length > 0 ? (
        <button type="button" className={styles.growSkip} onClick={() => setMoving(true)}>
          {t('claim.grow.move')}
        </button>
      ) : null}
      <button type="button" className={styles.growSkip} onClick={onLeave}>
        {t('claim.grow.skip')}
      </button>
      {moving ? <MoveHereSheet spaceId={space.id} spaceName={space.name} onClose={() => setMoving(false)} /> : null}
    </section>
  );
}
