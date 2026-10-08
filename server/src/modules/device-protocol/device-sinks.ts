import { Metric, OutputMetric } from '@fg2/shared-types/v1';

/**
 * What the ingest hands on once it has read a message.
 *
 * The protocol module translates the device's vocabulary and stores what a
 * device *is*; everything that happens because a message arrived belongs to
 * somebody else - the time series, the alarm state machine, the camera
 * pipeline, the tunnel, the firmware rollout. Each of those is named here as the
 * narrowest port the ingest needs, and bound to whoever provides it where the
 * modules are wired together.
 *
 * Every one of them is optional. A device is still heard, still recorded and
 * still answered when a part of the server is not there, which is what keeps the
 * protocol from depending on the shape of the rest of it.
 */

/** One reading document in the device's own field names, which is what the store writes. */
export interface DeviceSample {
  measuredAt: Date;
  sensors: Record<string, number>;
  outputs: Record<string, number>;
}

/** Provided by the data layer (`DataService.writeSample`). */
export interface DeviceSampleSink {
  writeSample(deviceId: string, sample: DeviceSample): Promise<void>;
}

export const DEVICE_SAMPLE_SINK = 'device-protocol:samples';

/**
 * One device's readings of one instant, in the names the contract gives them,
 * and the outputs it was driving at that instant beside them - a rule may watch
 * either, so the sample carries both halves of the message.
 */
export interface MetricSample {
  deviceId: string;
  measuredAt: Date;
  /** A metric the device did not report is absent; no rule on it is evaluated. */
  values: Partial<Record<Metric, number>>;
  /** The same, for the outputs: the value as the device reports it, never scaled. */
  outputs: Partial<Record<OutputMetric, number>>;
}

/** The same reading, in those names. Provided by the alarm engine (`onSample`), which has rules on both halves. */
export interface MetricSampleSink {
  onSample(sample: MetricSample): Promise<void>;
}

export const DEVICE_METRIC_SINK = 'device-protocol:metrics';

/** One frame out of the tunnel a device holds open. Provided by the tunnel. */
export interface DeviceTunnelSink {
  onTunnelReadDataReceived(deviceId: string, payload: string): Promise<void> | void;
}

export const DEVICE_TUNNEL_SINK = 'device-protocol:tunnel';

/**
 * That a device has said something about its camera - paired another, secured
 * it with a new password, learned its P2P id. Provided by the camera pipeline,
 * which may be holding off a camera that refused it and should try again.
 */
export interface DeviceCameraReportSink {
  cameraReported(deviceId: string): void;
}

export const DEVICE_CAMERA_REPORT_SINK = 'device-protocol:camera-reports';

/**
 * That a device is there, and what it came back running. Provided by the
 * firmware rollout, which decides from the two whether the device is told to
 * update and whether an update it was told about has finished.
 */
export interface DevicePresenceSink {
  onDeviceSeen(deviceId: string): Promise<void> | void;
  onFirmwareReported(deviceId: string, firmwareId: string): Promise<void> | void;
}

export const DEVICE_PRESENCE_SINK = 'device-protocol:presence';

/**
 * That a device germinates, or what it germinates with has just been chosen:
 * whether the stage's "too humid" warns there or rests (`GerminationChoices`).
 * Provided by the alarms, which act on it at once rather than at the device's
 * next reading - an alert the grower has just asked to be quiet goes quiet with
 * the save - and give a device asked to warn the stage's "too humid" to warn
 * with where it has none.
 */
export interface DeviceGerminationSink {
  germinationChanged(deviceId: string): Promise<void>;
}

export const DEVICE_GERMINATION_SINK = 'device-protocol:germination';
