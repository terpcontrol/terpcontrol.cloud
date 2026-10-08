import { type LucideIcon, RotateCcw, RotateCw, TrianglesCenterlineDashedHorizontal, TrianglesCenterlineDashedVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Camera, CameraOrientation } from '@fg2/shared-types/v1';
import { useLatestStill } from '@/api/cameras';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import ui from '@/ui/ui.module.css';
import { isPortrait, isUpright, previewTransform, turned, UPRIGHT, type TurnAction } from './turning';
import styles from './CameraPage.module.css';

const BUTTONS = [
  { action: 'left', Icon: RotateCcw, label: 'camera.orientation.left' },
  { action: 'right', Icon: RotateCw, label: 'camera.orientation.right' },
  // Named by the line the picture is mirrored across, which is the other way round from the mirror it makes.
  { action: 'mirror', Icon: TrianglesCenterlineDashedVertical, label: 'camera.orientation.mirror' },
  { action: 'flip', Icon: TrianglesCenterlineDashedHorizontal, label: 'camera.orientation.flip' },
] as const satisfies readonly { action: TurnAction; label: string; Icon: LucideIcon }[];

/**
 * Which way up the camera's pictures are stored: for a camera mounted on its
 * side, upside down or looking through a mirror.
 *
 * Each button turns the picture as it is shown, and the camera's newest still
 * shows the result before it is saved. That still is already turned the way
 * the camera was set when it was taken, which it carries, so the preview turns
 * it by the difference rather than by the whole setting - and a still taken
 * before a save is not drawn as though the save had been undone. Saving turns
 * the pictures to come; the ones already taken keep the orientation they were
 * stored with, which is why the note says so.
 *
 * Somebody who may only look is told what the setting is and given nothing to
 * press.
 */
export function Orientation({ camera, value, onChange }: { camera: Camera; value: CameraOrientation; onChange?: (next: CameraOrientation) => void }) {
  const { t } = useTranslation();
  const still = useLatestStill(camera.id, onChange !== undefined).data ?? null;
  const src = still ? mediaUrl(still.id, THUMBNAIL_WIDTH.still) : null;

  return (
    <span className={styles.settingStack}>
      {onChange ? (
        <span className={styles.orientation}>
          <span className={styles.orientationPreview}>
            {src ? (
              <img src={src} alt={t('camera.orientation.preview')} style={{ transform: previewTransform(still?.orientation ?? UPRIGHT, value) }} />
            ) : (
              <span className={`mono ${styles.orientationNone}`}>{t('camera.orientation.noPicture')}</span>
            )}
          </span>
          <span className={styles.orientationButtons} role="group" aria-label={t('camera.orientation.label')}>
            {BUTTONS.map(({ action, Icon, label }) => (
              <button
                key={action}
                type="button"
                className={`${ui.button} ${styles.orientationButton}`}
                aria-label={t(label)}
                title={t(label)}
                onClick={() => onChange(turned(value, action))}
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden />
              </button>
            ))}
          </span>
        </span>
      ) : null}
      <span className={`mono ${styles.settingValue}`}>{describe(t, value)}</span>
      {onChange && !isUpright(value) ? (
        <button type="button" className={`mono ${styles.settingLink} ${styles.orientationReset}`} onClick={() => onChange(UPRIGHT)}>
          {t('camera.orientation.reset')} ›
        </button>
      ) : null}
      {onChange ? <span className={`${ui.note} ${styles.settingNote}`}>{t('camera.orientation.note')}</span> : null}
    </span>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The setting in words, as the camera's other settings are said beside it. */
const describe = (t: Translate, orientation: CameraOrientation): string => {
  if (isUpright(orientation)) return t('camera.orientation.asDelivered');

  return [
    orientation.rotation !== 0 ? t('camera.orientation.turnedBy', { degrees: orientation.rotation }) : null,
    orientation.flipHorizontal ? t('camera.orientation.mirrored') : null,
    orientation.flipVertical ? t('camera.orientation.flipped') : null,
    isPortrait(orientation) ? t('camera.orientation.portrait') : null,
  ]
    .filter(Boolean)
    .join(' · ');
};
