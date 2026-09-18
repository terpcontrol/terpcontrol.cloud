import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceClaimResult } from '@fg2/shared-types/v1';
import { useDevices } from '@/api/devices';
import { useReportFreshness } from '@/ui/freshness';
import ui from '@/ui/ui.module.css';
import { EmptyHome } from './EmptyHome';
import { Placeholder } from './Placeholder';

/**
 * Home is one card per space, and a claim always ends in a space, so a person
 * with no devices has nothing here yet. A claim made on this screen keeps its
 * acknowledgement in front of them; the reload after it lands on the cards.
 */
export function Home() {
  const { t } = useTranslation();
  const devices = useDevices();
  const [claimed, setClaimed] = useState<DeviceClaimResult | null>(null);

  useReportFreshness(devices.dataUpdatedAt ? new Date(devices.dataUpdatedAt).toISOString() : null);

  if (devices.isPending) return null;
  if (devices.isError) return <p className={ui.problem}>{t('shell.loadFailed')}</p>;

  if (claimed || devices.data.items.length === 0) return <EmptyHome claimed={claimed} onClaimed={setClaimed} />;
  return <Placeholder titleKey="shell.tabs.home" />;
}
