import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Device, HomeSpaceCard } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useDeviceLive } from '@/api/devices';
import { maintenanceQuiet, type Quiet } from '@/ui/maintenance';
import { offsetOf } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import { ownStatusOf } from '@/screens/control/devices/own-summary';
import { leadOf, leadValuesOf } from '@/screens/control/lead';
import { judgedBy } from './attention';
import { contradictedModeOf, controlOffOf, openWords, statusOf, statusText } from './place';
import { useHumidifierHold, usePlaceAlerts } from './reads';

/**
 * What a place says about itself away from its own page - on its Start card
 * and in the header's choice of place: the status sentence of its Start, from
 * the same arithmetic, so the three never disagree about a tent.
 *
 * A place has one climate, its lead device's (`leadOf`), and what else stands
 * there is listed under Steuerung.
 */
export const useCardStatus = (card: HomeSpaceCard & { spaceId: string }, devices: Device[] | undefined, now: DateTime) => {
  const { t } = useTranslation();
  const zone = useZone();
  const here = (devices ?? []).filter(device => card.deviceIds.includes(device.id));
  const device = leadOf(here, card.climates);
  const { climate, values, placeWide } = leadValuesOf(device, card.climates, card.values, useDeviceLive(device?.id ?? null).data);
  const setpoints = climate?.setpoints ?? (placeWide ? card.setpoints : []);
  const quiet = here.map(one => maintenanceQuiet(one, DateTime.max(now, serverNow()))).find((one): one is Quiet => one !== null) ?? null;
  const humidifierHold = useHumidifierHold(device);
  // The place lives and falls silent with the device that holds its climate, as its own Start judges it.
  const judging = judgedBy(values, here, device, now);
  const silence = judging.silence;
  const silentSince = silence && !silence.waiting ? silence.since : null;
  const openAlerts = usePlaceAlerts(card.openAlerts, here, now);
  const status = statusOf(
    {
      ...card,
      values: judging.values,
      setpoints,
      openAlerts,
      leadId: device?.id,
      quiet,
      controlOff: controlOffOf(here),
      humidifierHold,
      silentSince,
      mode: contradictedModeOf(device, card.grow?.stage),
    },
    now,
  );
  const own = status.kind === 'noTargets' ? ownStatusOf(t, device, offsetOf(now, zone)) : null;
  // `said` whole for a line of its own; `words` and `behind` apart where what stands open is drawn in its own colour.
  const words = own ?? statusText(t, status, now, zone, false);
  const behind = openWords(t, status);

  return { here, device, values, setpoints, status, said: [words, behind].filter(Boolean).join(' · '), words, behind };
};
