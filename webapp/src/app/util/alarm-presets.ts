import { DiaryLifecycleStage } from '@fg2/shared-types';

export interface AlarmPresetContext {
  /** Current grow stage, used for stage-aware thresholds (humidity). */
  stage?: DiaryLifecycleStage | null;
  deviceType?: string;
  translate: (key: string) => string;
}

export interface AlarmPresetDef {
  id: string;
  icon: string;
  sensorType: string;
  /** Hidden on devices without a CO2 sensor. */
  requiresCo2?: boolean;
  build: (ctx: AlarmPresetContext) => Record<string, any>;
}

/**
 * Ready-made alarms with sensible grow-room defaults. All presets start as
 * 'info' log alarms — the channel (email/webhook) is chosen in the add flow.
 * thresholdSeconds > 4 activates the server's sustained-exceedance check,
 * which is also what makes the boolean output sensors ("running
 * continuously") work as duration alarms.
 */
export const ALARM_PRESETS: AlarmPresetDef[] = [
  {
    id: 'heat_day',
    icon: 'thermometer-outline',
    sensorType: 'temperature',
    build: () => ({
      sensorType: 'temperature',
      upperThreshold: 30,
      lowerThreshold: null,
      thresholdSeconds: 300,
      cooldownSeconds: 600,
      retriggerSeconds: 3600,
    }),
  },
  {
    id: 'cold_night',
    icon: 'snow-outline',
    sensorType: 'temperature',
    build: () => ({
      sensorType: 'temperature',
      upperThreshold: null,
      lowerThreshold: 15,
      thresholdSeconds: 300,
      cooldownSeconds: 600,
      retriggerSeconds: 3600,
    }),
  },
  {
    id: 'humidity_high',
    icon: 'water-outline',
    sensorType: 'humidity',
    build: ctx => ({
      sensorType: 'humidity',
      // Mold risk starts far lower once buds form.
      upperThreshold: ctx.stage === 'flowering' ? 60 : 75,
      lowerThreshold: null,
      thresholdSeconds: 900,
      cooldownSeconds: 1800,
      retriggerSeconds: 7200,
    }),
  },
  {
    id: 'humidity_low',
    icon: 'sunny-outline',
    sensorType: 'humidity',
    build: () => ({
      sensorType: 'humidity',
      upperThreshold: null,
      lowerThreshold: 35,
      thresholdSeconds: 900,
      cooldownSeconds: 1800,
      retriggerSeconds: 7200,
    }),
  },
  {
    id: 'co2_empty',
    icon: 'cloud-outline',
    sensorType: 'co2',
    requiresCo2: true,
    build: () => ({
      sensorType: 'co2',
      upperThreshold: null,
      // A live enrichment setup holding below ambient means the bottle is empty.
      lowerThreshold: 350,
      thresholdSeconds: 600,
      cooldownSeconds: 3600,
      retriggerSeconds: 21600,
    }),
  },
  {
    id: 'running_continuously',
    icon: 'infinite-outline',
    sensorType: 'dehumidifier',
    build: () => ({
      // The dehumidifier output is the fridge compressor on fridges and the
      // dehumidifier socket on controllers; 30 min non-stop means something
      // is off (door open, seal broken, unit too small).
      sensorType: 'dehumidifier',
      upperThreshold: null,
      lowerThreshold: null,
      thresholdSeconds: 1800,
      cooldownSeconds: 3600,
      retriggerSeconds: 21600,
    }),
  },
];

export function availableAlarmPresets(options: { hasCo2: boolean }): AlarmPresetDef[] {
  return ALARM_PRESETS.filter(preset => !preset.requiresCo2 || options.hasCo2);
}

export function presetNameKey(def: AlarmPresetDef, deviceType?: string): string {
  if (def.id === 'running_continuously' && (deviceType === 'fridge' || deviceType === 'fridge2')) {
    return 'alarmPresets.running_continuously.nameFridge';
  }
  return `alarmPresets.${def.id}.name`;
}

/** Creates a plain Alarm object (no alarmId — the server assigns one). */
export function buildAlarmFromPreset(def: AlarmPresetDef, ctx: AlarmPresetContext): Record<string, any> {
  return {
    name: ctx.translate(presetNameKey(def, ctx.deviceType)),
    actionType: 'info',
    actionTarget: '',
    additionalInfo: true,
    disabled: false,
    ...def.build(ctx),
  };
}
