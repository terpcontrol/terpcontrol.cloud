import { CameraOrientation } from '@fg2/shared-types/v1';

/** The picture as the camera delivers it. */
export const UPRIGHT: CameraOrientation = { rotation: 0, flipHorizontal: false, flipVertical: false };

/** A camera stored before it could be turned has no orientation, which is the picture as delivered. */
export const orientationOf = (camera: { orientation?: CameraOrientation | null }): CameraOrientation => camera.orientation ?? UPRIGHT;

/**
 * The ffmpeg filters that turn a picture as the contract orders it: mirrored
 * first, then rotated clockwise. Applied while the still is encoded, so a turned
 * picture costs no second JPEG generation.
 *
 * A half turn is both mirrors at once, so it is folded into them, and what is
 * left is at most one quarter turn.
 */
export const orientationFilters = ({ rotation, flipHorizontal, flipVertical }: CameraOrientation): string[] => {
  const halfTurn = rotation >= 180;
  return [
    flipHorizontal !== halfTurn ? 'hflip' : null,
    flipVertical !== halfTurn ? 'vflip' : null,
    rotation % 180 === 90 ? 'transpose=clock' : null,
  ].filter((filter): filter is string => filter !== null);
};

/** The `-vf` arguments for an ffmpeg run, or none for a picture that stays as it is. */
export const orientationArgs = (orientation: CameraOrientation): string[] => {
  const filters = orientationFilters(orientation);
  return filters.length > 0 ? ['-vf', filters.join(',')] : [];
};
