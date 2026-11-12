import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, GrowthStage, Space } from '@fg2/shared-types/v1';
import { expectLayout } from '@/api/layers';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { useSpaceOverview } from '@/api/spaces';
import { typeName } from '@/ui/naming';
import ui from '@/ui/ui.module.css';
import { WhatGrows } from '@/screens/grow/new/WhatGrows';
import { MoveHereSheet } from '@/screens/space/MoveHereSheet';
import { useMovableGrows } from '@/screens/space/movable-grows';
import { shownStill } from '@/screens/start/place';
import { FlowHead } from './FlowHead';
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
 *
 * The form opens on the stage the place is on - the one a step earlier put it
 * on, or, when the flow is picked up again later, the one its device's
 * settings say, which the form reads and waits for (`WhatGrows`). A grow
 * started here brings the diary into the bar, which the
 * shell would announce as a change of layout; setup did it and says so first
 * (`expectLayout`), so nothing announces what the grower just chose.
 */
export function GrowStep({
  device,
  space,
  stage,
  step,
  of,
  headingRef,
  onStarting,
  onLeave,
}: {
  device: Device;
  space: Space;
  /** The stage the place was put on a step earlier in this sitting; null where the flow was picked up again. */
  stage: GrowthStage | null;
  step: number;
  of: number;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** The form was sent, so the page stays until it has been answered - whatever the grows of the place say meanwhile. */
  onStarting: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const overview = useSpaceOverview(space.id).data;
  const still = overview?.cameras.map(shownStill).find(one => one !== null) ?? null;
  const movable = useMovableGrows(space.id);
  const [moving, setMoving] = useState(false);

  const started = useRef(false);

  // Said before the form can be sent, and taken back when the page is left - or goes - without a grow having been started.
  const unsaid = () => {
    if (!started.current) expectLayout({ diary: false });
  };
  useEffect(() => {
    expectLayout({ diary: true });
    return unsaid;
  }, []);
  const skip = () => {
    unsaid();
    onLeave();
  };

  return (
    <section className={styles.screen}>
      <FlowHead device={typeName(device.type, t)} step={step} of={of} onClose={skip} />
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
      <WhatGrows
        spaceId={space.id}
        stage={stage ?? undefined}
        onStarting={onStarting}
        onStarted={() => {
          started.current = true;
          onLeave();
        }}
        submitClass={`${ui.button} ${ui.primary} ${styles.growStart}`}
      />
      {movable.items.length > 0 ? (
        <button type="button" className={styles.growSkip} onClick={() => setMoving(true)}>
          {t('claim.grow.move')}
        </button>
      ) : null}
      <button type="button" className={styles.growSkip} onClick={skip}>
        {t('claim.grow.skip')}
      </button>
      {moving ? <MoveHereSheet spaceId={space.id} spaceName={space.name} onClose={() => setMoving(false)} /> : null}
    </section>
  );
}
