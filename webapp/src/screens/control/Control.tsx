import { useTranslation } from 'react-i18next';
import { useDevices } from '@/api/devices';
import { LaterRound } from '@/ui/LaterRound';
import { LoadFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { PlanPanel } from './PlanPanel';
import styles from './Control.module.css';

/**
 * The tent's Control tab: what the controllers standing here are being run by.
 *
 * A plan belongs to a device and not to the place, because what a step writes is
 * that device's own configuration document - so a tent with two controllers in
 * it has two plans, and each is drawn with the name of the device it runs. A
 * tent with nothing in it says so rather than offering a recipe with nowhere to
 * send it.
 */
export function Control({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const mayManage = useMayManage();
  const devices = useDevices();

  if (devices.isPending) return <Waiting lines={4} />;
  if (!devices.data) return <LoadFailed retry={() => void devices.refetch()} />;

  const here = devices.data.items.filter(device => device.spaceId === spaceId);

  return (
    <div className={styles.page}>
      {here.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('space.control.noController')}</p>
      ) : (
        here.map(device => <PlanPanel key={device.id} device={device} mayManage={mayManage} />)
      )}

      <LaterRound round={10} what="space.control.laterRest" />
    </div>
  );
}
