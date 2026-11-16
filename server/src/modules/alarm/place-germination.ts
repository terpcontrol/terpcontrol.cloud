import { Model } from 'mongoose';
import { type GerminationShape, germinationOf } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { hasWorkModes } from '@modules/device-protocol/work-modes';

const FIELDS = { id: 1, type: 1, spaceId: 1, 'configuration.workmode': 1, germinationChoices: 1, 'appliedClimate.stage': 1 } as const;

type Placed = Pick<StoredDevice, 'id' | 'type' | 'spaceId' | 'germinationChoices'> & {
  configuration?: { workmode?: unknown } | null;
  appliedClimate?: { stage?: string } | null;
};

const shapeOf = (device: Placed): GerminationShape => ({
  type: device.type,
  workmode: device.configuration?.workmode,
  choices: device.germinationChoices,
  stage: device.appliedClimate?.stage ?? null,
});

/**
 * The germination a device's "too humid" goes by (`germinationOf`): its own where it has a work mode, else its
 * place's - a lamp module, a fan or a socket rests where the controller beside it germinates, as the switch promises.
 */
export const germinationHere = async (devices: Model<StoredDevice>, deviceId: string): Promise<ReturnType<typeof germinationOf>> => {
  const device = await devices.findOne({ id: deviceId }, FIELDS).lean<Placed | null>();
  if (!device) return { workmode: null, choices: null };
  const place =
    device.spaceId && !hasWorkModes(device.type)
      ? await devices.find({ spaceId: device.spaceId, id: { $ne: device.id } }, FIELDS).lean<Placed[]>()
      : [];
  return germinationOf(shapeOf(device), place.map(shapeOf));
};
