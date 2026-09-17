import { Schema } from 'mongoose';
import type { Device, DeviceSettings, DeviceState } from '@fg2/shared-types/v1';
import { firmwareChannel } from '@fg2/shared-types/v1-schemas';

/**
 * A device as it is stored: the contract's `Device` with its instants as BSON
 * dates, plus the broker credentials, which the contract has no field for.
 *
 * "None" is `null` and never a missing field. That is not decoration: the
 * cleanup sweeps delete by `$in` over a list of ids, and a `$in` carrying a
 * null also matches every document where the field is absent.
 */

/** What the device signs in to the broker with. */
export interface StoredDeviceMqtt {
  username: string;
  passwordHash: string;
}

export interface StoredDeviceState extends Omit<
  DeviceState,
  'lastSeenAt' | 'claimedAt' | 'updateStartedAt' | 'updateEndedAt' | 'maintenanceUntil' | 'socketStateChangedAt'
> {
  lastSeenAt: Date | null;
  claimedAt: Date | null;
  updateStartedAt: Date | null;
  updateEndedAt: Date | null;
  maintenanceUntil: Date | null;
  socketStateChangedAt: Record<string, Date>;
}

export interface StoredDevice extends Omit<Device, 'createdAt' | 'state'> {
  createdAt: Date;
  mqtt: StoredDeviceMqtt | null;
  state: StoredDeviceState;
}

const mqttSchema = new Schema<StoredDeviceMqtt>(
  {
    username: { type: String, required: true },
    passwordHash: { type: String, required: true },
  },
  { _id: false, versionKey: false },
);

const firmwareTargetSchema = new Schema<Device['firmware']>(
  {
    // A device with no update setting of its own follows no channel and stays
    // on what an operator picked, which is what one gets today.
    channel: { type: String, enum: firmwareChannel.options, required: true, default: 'manual' },
    targetId: { type: String, default: null },
  },
  { _id: false, versionKey: false },
);

const settingsSchema = new Schema<DeviceSettings>(
  {
    // The offsets and the factor the cloud has always computed VPD and PPFD with.
    vpdLeafOffsetDay: { type: Number, required: true, default: -2 },
    vpdLeafOffsetNight: { type: Number, required: true, default: 0 },
    ppfdLuxFactor: { type: Number, required: true, default: 0.015 },
  },
  { _id: false, versionKey: false },
);

const stateSchema = new Schema<StoredDeviceState>(
  {
    lastSeenAt: { type: Date, default: null },
    claimedAt: { type: Date, default: null },
    firmwareId: { type: String, default: null },
    updateStartedAt: { type: Date, default: null },
    updateEndedAt: { type: Date, default: null },
    maintenanceUntil: { type: Date, default: null },
    // The raw `hardware-info` report, flat as the device sends it. Its keys
    // belong to the firmware of that type, so nothing here constrains them.
    hardware: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
    // Slot to the instant that socket row was last seen to change state; the
    // report says a row changed but not when, so the ingest stamps it.
    socketStateChangedAt: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
  },
  { _id: false, versionKey: false, minimize: false },
);

export const devicesSchema = new Schema<StoredDevice>(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    // Not an enum: the set of hardware types grows, and a cloud that rejected
    // an unknown one would refuse to register a device newer than itself.
    type: { type: String, required: true },
    classId: { type: String, default: null },
    serialNumber: { type: Number, default: null },
    ownerId: { type: String, default: null },
    spaceId: { type: String, default: null },
    name: { type: String, default: null },
    // Never served: the contract has no field for it. Read by `MqttAuthService`
    // alone, which asks for it explicitly.
    mqtt: { type: mqttSchema, default: null, select: false },
    firmware: { type: firmwareTargetSchema, required: true, default: () => ({}) },
    // The device's own configuration document, null until it reports one. Its
    // schema belongs to the firmware of that type and is not restated here.
    configuration: { type: Schema.Types.Mixed, default: null },
    settings: { type: settingsSchema, required: true, default: () => ({}) },
    isDemo: { type: Boolean, required: true, default: false },
    state: { type: stateSchema, required: true, default: () => ({}) },
  },
  // An empty configuration document is a device that reported one and said
  // nothing, which mongoose would otherwise strip back to "never reported".
  { collection: 'devices', versionKey: false, minimize: false },
);

// The broker asks for a device by the name it signs in with, on every connection.
// Partial, because a device row made by hand has no credentials until it registers.
devicesSchema.index({ 'mqtt.username': 1 }, { unique: true, partialFilterExpression: { 'mqtt.username': { $type: 'string' } } });
// A person's devices, and the devices of one space's card.
devicesSchema.index({ ownerId: 1 });
devicesSchema.index({ spaceId: 1 });
// The rollout counts a class by the build its devices run, and picks the next ones to update.
devicesSchema.index({ classId: 1, 'state.firmwareId': 1 });
