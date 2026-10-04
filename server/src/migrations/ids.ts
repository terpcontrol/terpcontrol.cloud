import { v5 as uuidv5 } from 'uuid';

/**
 * Ids the migration invents.
 *
 * Every copy is an upsert by `id`, which is what makes a run that was killed
 * safe to repeat - so an id may never be drawn at random. It is derived from
 * what the old document already is: a device's id, an image's id, a log entry's
 * ObjectId. The same source therefore always produces the same id, on a rerun
 * and in a dry run alike, and a document written by an earlier attempt is
 * updated rather than duplicated.
 *
 * A UUID namespace fixed here rather than the default one, so an id derived by
 * this migration can never collide with a v5 id derived anywhere else.
 */
const NAMESPACE = '3a1c9f26-0f8b-5d47-9b6a-5c7d2f1e4a80';

export const derivedId = (kind: string, ...parts: (string | number)[]): string => uuidv5(`${kind}:${parts.join(':')}`, NAMESPACE);

/** The space a claimed device becomes, and what every row that sits in it points at. */
export const spaceIdOf = (deviceId: string): string => derivedId('space', deviceId);

/** One camera per device: the Terp Cam it pairs, the RTSP stream it pulls, or the one its pictures came from. */
export const cameraIdOf = (deviceId: string): string => derivedId('camera', deviceId);

/** A plan belongs to exactly one device, so the device names it. */
export const planIdOf = (deviceId: string): string => derivedId('plan', deviceId);

/** A grow is a stretch of one device's lifecycle entries, named by the device and the instant it began. */
export const growIdOf = (deviceId: string, startedAt: number): string => derivedId('grow', deviceId, startedAt);
