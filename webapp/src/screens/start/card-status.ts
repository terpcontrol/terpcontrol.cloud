import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Device, HomeSpaceCard } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { maintenanceQuiet, type Quiet } from '@/ui/maintenance';
import { offsetOf } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import { ownStatusOf } from '@/screens/control/devices/own-summary';
import { silenceOf } from './attention';
import { climateDeviceOf, controlOffOf, statusOf, statusText } from './place';
import { useHumidifierHold, usePlaceAlerts } from './reads';

/**
 * What a place says about itself away from its own page - on its Start card
 * and in the header's choice of place: the status sentence of its Start, from
 * the same arithmetic, so the three never disagree about a tent.
 *
 * A place has one climate: the first device the server names as holding one
 * speaks for it, and what else stands there is listed under Steuerung.
 */
export const useCardStatus = (card: HomeSpaceCard & { spaceId: string }, devices: Device[] | undefined, now: DateTime) => {
  const { t } = useTranslation();
  const zone = useZone();
  const here = (devices ?? []).filter(device => card.deviceIds.includes(device.id));
  const climate = card.climates[0] ?? null;
  const device = here.find(one => one.id === climate?.deviceId) ?? climateDeviceOf(here, card.deviceIds);
  const values = climate?.values ?? card.values;
  const setpoints = climate?.setpoints ?? card.setpoints;
  const quiet = here.map(one => maintenanceQuiet(one, DateTime.max(now, serverNow()))).find((one): one is Quiet => one !== null) ?? null;
  const humidifierHold = useHumidifierHold(device);
  const silence = silenceOf(values, here, now);
  const silentSince = silence && !silence.waiting ? silence.since : null;
  const openAlerts = usePlaceAlerts(card.openAlerts, here, now);
  const status = statusOf({ ...card, values, setpoints, openAlerts, quiet, controlOff: controlOffOf(here), humidifierHold, silentSince }, now);
  const said = (status.kind === 'noTargets' ? ownStatusOf(t, device, offsetOf(now, zone)) : null) ?? statusText(t, status, now, zone);

  return { here, device, values, status, said };
};
