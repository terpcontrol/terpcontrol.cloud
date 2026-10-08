/**
 * Which half of the day the cameras of a place saw, which is what a smart plug's
 * VPD goes by where the plug keeps no schedule of its own (ADR 0006): a camera
 * in its night mode sends grey stills.
 *
 * The stills belong to the camera part, so it provides this. Unwired, such a
 * plug's VPD takes the night's leaf offset, as it always did.
 */
export interface CameraDaylight {
  /**
   * What the stills of the cameras in a space say of each instant from half a
   * step before `startsAt` to `endsAt`, in epoch milliseconds: true by day,
   * false by night, null where none of them can say. The reads behind it do
   * not grow with the instants asked; the step is the grain they are asked at.
   */
  dayIn(spaceId: string, window: { startsAt: Date; endsAt: Date; stepSeconds: number }): Promise<(at: number) => boolean | null>;
}

export const CAMERA_DAYLIGHT = Symbol('CameraDaylight');
