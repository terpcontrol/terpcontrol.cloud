import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Device, HomeSpaceCard } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { maintenanceQuiet, type Quiet } from '@/ui/maintenance';
import { deviceTitle } from '@/ui/naming';
import { offsetOf } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import { ownStatusOf } from '../control/devices/own-summary';
import { climateDeviceOf, controlOffOf, statusOf, statusText, toneOf } from './place';
import { useHumidifierHold } from './reads';

/** How urgently a tone asks for a person, so the worst climate of several speaks for its place. */
const TONE_RANK: Record<ReturnType<typeof toneOf>, number> = { alarm: 3, warn: 2, quiet: 1, good: 0 };

/**
 * What a place says about itself away from its own page - on its Start card
 * and in the header's choice of place: the cockpit's own status sentence, from
 * the same arithmetic, so the three never disagree about a tent.
 *
 * A place holding several climates is said climate by climate: the worst of
 * them speaks for the place, named by its device.
 */
export const useCardStatus = (card: HomeSpaceCard & { spaceId: string }, devices: Device[] | undefined, now: DateTime) => {
  const { t } = useTranslation();
  const zone = useZone();
  const here = (devices ?? []).filter(device => card.deviceIds.includes(device.id));
  const device = climateDeviceOf(here, card.deviceIds);
  const quiet = here.map(one => maintenanceQuiet(one, DateTime.max(now, serverNow()))).find((one): one is Quiet => one !== null) ?? null;
  const humidifierHold = useHumidifierHold(device);
  const climates = card.climates.map(climate => {
    const mine = here.filter(one => one.id === climate.deviceId);
    const status = statusOf(
      {
        ...card,
        values: climate.values,
        setpoints: climate.setpoints,
        deviceIds: [climate.deviceId],
        quiet,
        controlOff: controlOffOf(mine),
        humidifierHold: null,
      },
      now,
    );
    return { climate, device: mine[0] ?? null, status };
  });
  const worst = climates.length > 1 ? [...climates].sort((a, b) => TONE_RANK[toneOf(b.status)] - TONE_RANK[toneOf(a.status)])[0] : null;
  const status = worst?.status ?? statusOf({ ...card, quiet, controlOff: controlOffOf(here), humidifierHold }, now);
  const sentence =
    (status.kind === 'noTargets' ? ownStatusOf(t, worst?.device ?? device, offsetOf(now, zone)) : null) ?? statusText(t, status, now, zone);
  const said = worst?.device && status.kind !== 'alert' ? `${deviceTitle(worst.device, t, devices)} · ${sentence}` : sentence;

  return { here, device, humidifierHold, climates, status, said };
};
