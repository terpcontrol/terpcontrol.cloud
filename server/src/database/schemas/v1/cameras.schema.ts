import { Schema } from 'mongoose';
import { Camera, CameraEntitlement, CameraState } from '@fg2/shared-types/v1';
import { cameraKind, cameraModel, cameraTransport, grantKind } from '@fg2/shared-types/v1-schemas';

/**
 * A camera of its own rather than a field on a device: a tent has the Terp Cam
 * its controller pairs, RTSP cameras pulled through that controller's tunnel and
 * standalone Terp Cams the cloud reaches itself.
 *
 * Two fields are stored differently from the way they are served. `secret` has no
 * place in the contract at all, and `url` carries the credentials the stream is
 * opened with while the resource answers the same URL with them stripped.
 */

/** How often the pipeline has always asked a camera for a picture. */
const DEFAULT_STILL_INTERVAL_SECONDS = 30;

/** `tier` and `renewalVisible` are read from `validUntil` and the install's configuration on every serialisation, so neither is stored. */
type CameraEntitlementDocument = Omit<CameraEntitlement, 'validUntil' | 'tier' | 'renewalVisible'> & { validUntil: Date | null };

type CameraStateDocument = Omit<CameraState, 'lastStillAt'> & { lastStillAt: Date | null };

export type CameraDocument = Omit<Camera, 'createdAt' | 'removedAt' | 'entitlement' | 'state'> & {
  createdAt: Date;
  removedAt: Date | null;
  entitlement: CameraEntitlementDocument;
  state: CameraStateDocument;
  /** A Terp Cam's P2P credential. Never serialised, to the owner no more than to anybody else. */
  secret: string | null;
};

/** Twelve months per camera. Nothing renews on its own: the admin route is the only writer. */
const entitlementSchema = new Schema<CameraEntitlementDocument>(
  {
    validUntil: { type: Date, default: null },
    grant: { type: String, enum: grantKind.options, default: null },
  },
  { _id: false },
);

/** Maintained by the poller and the protocol module; never written by a client. */
const stateSchema = new Schema<CameraStateDocument>(
  {
    lastStillAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    firmwareVersion: { type: String, default: null },
  },
  { _id: false },
);

export const camerasSchema = new Schema<CameraDocument>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    ownerId: { type: String, required: true },
    kind: { type: String, enum: cameraKind.options, required: true },
    deviceId: { type: String, default: null },
    spaceId: { type: String, default: null },
    name: { type: String, required: true },
    looksAt: { type: String, default: null },
    plantIds: { type: [String], required: true, default: [] },
    did: { type: String, default: null },
    uid: { type: String, default: null },
    ip: { type: String, default: null },
    // Read by the services that open a stream, which ask for it by name; every
    // other read leaves it behind, so it cannot reach a serialiser by accident.
    secret: { type: String, default: null, select: false },
    // The whole stream URL, credentials included. The camera serialiser strips them.
    url: { type: String, default: null },
    transport: { type: String, enum: cameraTransport.options, default: null },
    tunnel: { type: Boolean, required: true, default: false },
    model: { type: String, enum: cameraModel.options, default: null },
    stillIntervalSeconds: { type: Number, required: true, default: DEFAULT_STILL_INTERVAL_SECONDS },
    nightOff: { type: Boolean, required: true, default: false },
    maintenanceOff: { type: Boolean, required: true, default: false },
    logErrors: { type: Boolean, required: true, default: false },
    entitlement: { type: entitlementSchema, required: true, default: () => ({ validUntil: null, grant: null }) },
    isDemo: { type: Boolean, required: true, default: false },
    removedAt: { type: Date, default: null },
    state: { type: stateSchema, required: true, default: () => ({ lastStillAt: null, lastError: null, firmwareVersion: null }) },
  },
  { collection: 'cameras', versionKey: false },
);

// A person's cameras, and the cameras of one space, which is what the tent page
// lists and what the timelapse builder and retention iterate.
camerasSchema.index({ ownerId: 1, createdAt: -1 });
camerasSchema.index({ spaceId: 1 });
// The controller that answers for a camera: the protocol module upserts a row
// from what a device reports, and the tunnel path reads it back.
camerasSchema.index({ deviceId: 1 });
// A Terp Cam is found again by the P2P id printed on it, so that unpairing and
// pairing it again keeps the entitlement it already has. Not unique: a removed
// camera stays behind as a tombstone and must not refuse the new row.
camerasSchema.index({ did: 1 }, { partialFilterExpression: { did: { $type: 'string' } } });
