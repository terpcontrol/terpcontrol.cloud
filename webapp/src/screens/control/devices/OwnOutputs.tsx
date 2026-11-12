import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { controlPath, devicePath } from '@/app/places';
import { Facts } from '@/ui/Facts';
import { Row, Rows } from '@/ui/Rows';
import { useLeads } from '../lead';
import { FridgeFansPanel } from './FridgeFansPanel';
import { fanFactsOf } from './own-summary';

/**
 * What a device drives by a setting of its own, among the outputs: a fridge's
 * fans, set here, and an AIR fan's speed, which is the fan's own control and
 * set where the fan's settings stand - Steuerung's top where it is the place's
 * climate, its own page otherwise. The row says it and leads there.
 */
export function OwnOutputs({ device, mayManage }: { device: Device; mayManage: boolean }) {
  if (!device.configuration) return null;
  if (device.type === 'fridge') return <FridgeFansPanel device={device} mayManage={mayManage} />;
  return device.type === 'fan' ? <FanRow fan={device} /> : null;
}

function FanRow({ fan }: { fan: Device }) {
  const { t } = useTranslation();
  const leads = useLeads(fan);

  return (
    <Rows>
      <Row
        to={leads && fan.spaceId ? controlPath(fan.spaceId) : devicePath(fan.id)}
        title={t('fanSettings.title')}
        line={<Facts facts={fanFactsOf(t, fan)} />}
      />
    </Rows>
  );
}
