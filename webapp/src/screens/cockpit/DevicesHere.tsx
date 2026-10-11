import { ChevronRight, Cpu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Device } from '@fg2/shared-types/v1';
import { devicesPath } from '@/app/places';
import { useDevices } from '@/api/devices';
import { deviceTitle } from '@/ui/naming';
import styles from './Cockpit.module.css';

/**
 * "3 devices · Tent controller · Light · Fan": what stands in a place, said
 * where the place is looked at. The tiles and the status sentence speak for the
 * device that holds the climate, so a lamp or a fan standing beside it would
 * otherwise first show up under Steuerung. Drawn only from the second device
 * on: with one, the place and its device are the same thing to the grower.
 *
 * On the cockpit it is the way to those devices' panels; on a Start card,
 * which is a way into the cockpit already, it is words.
 */
export function DevicesHere({
  spaceId,
  devices,
  lead,
  linked = true,
}: {
  spaceId: string;
  devices: Device[];
  /** The device the tiles speak for, named first; the rest follow by name. */
  lead: Device | null;
  linked?: boolean;
}) {
  const { t } = useTranslation();
  const among = useDevices(devices.length > 1).data?.items;
  if (devices.length < 2) return null;

  const titled = devices.map(device => ({ device, title: deviceTitle(device, t, among) }));
  titled.sort((a, b) => Number(b.device.id === lead?.id) - Number(a.device.id === lead?.id) || a.title.localeCompare(b.title));
  const words = [t('cockpit.devices.count', { count: devices.length }), ...titled.map(one => one.title)].join(' · ');

  return linked ? (
    <Link to={devicesPath(spaceId)} className={`mono ${styles.devicesHere}`} aria-label={t('cockpit.devices.open', { devices: words })}>
      <Cpu size={14} strokeWidth={2} aria-hidden />
      <span>{words}</span>
      <ChevronRight size={14} strokeWidth={2} aria-hidden />
    </Link>
  ) : (
    <p className={`mono ${styles.cardLine}`}>{words}</p>
  );
}
