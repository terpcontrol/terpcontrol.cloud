import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { useDevices } from '@/api/devices';
import { LoadFailed, Waiting } from '@/ui/PageState';
import { useMayLogIn, useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { Alarms } from './alarms/Alarms';
import { PlanPanel } from './PlanPanel';
import { Targets } from './targets/Targets';
import styles from './Control.module.css';

/** The two pages below the tab: targets set by hand, and the alarm rules under Advanced. */
const SUBPAGES = ['targets', 'alarms'] as const;
type ControlSub = (typeof SUBPAGES)[number];

const isSub = (value: string | null): value is ControlSub => (SUBPAGES as readonly string[]).includes(value ?? '');

/**
 * The tent's Control tab: what the controllers standing here are being run by.
 *
 * A plan belongs to a device and not to the place, because what a step writes is
 * that device's own configuration document - so a tent with two controllers in
 * it has two plans, and each is drawn with the name of the device it runs. A
 * tent with nothing in it says so rather than offering a recipe with nowhere to
 * send it, and points at the one thing that would change that: claiming a
 * device into the tent.
 *
 * Below the plan are the two pages that take the tent off it or watch over it:
 * targets set by hand, and, under Advanced, the alarm rules. Each is a page of
 * its own in the address, so an alert can link to the rule it came from and a
 * reload lands where it was; the sockets of everything standing here are on the
 * Devices tab, and Advanced says so rather than drawing them twice.
 */
export function Control({ spaceId, sub }: { spaceId: string; sub: string | null }) {
  const { t } = useTranslation();
  // Everything on this tab and on the two pages below it writes to a device
  // standing here, which the ADR's table puts at `manage` - so the question is
  // about this place and not about the session.
  const mayManage = useMayManage(spaceId);
  const mayLog = useMayLogIn(spaceId);
  const devices = useDevices();

  if (sub !== null && !isSub(sub)) return <Navigate to={`/spaces/${spaceId}/control`} replace />;

  if (devices.isPending) return <Waiting lines={4} />;
  if (!devices.data) return <LoadFailed retry={() => void devices.refetch()} />;

  const here = devices.data.items.filter(device => device.spaceId === spaceId);

  if (sub === 'targets') return <Targets spaceId={spaceId} devices={here} mayManage={mayManage} />;
  if (sub === 'alarms') return <Alarms spaceId={spaceId} devices={here} mayManage={mayManage} />;

  return (
    <div className={styles.page}>
      {here.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>
          {t('space.control.noController')}{' '}
          <Link to={`/spaces/${spaceId}/devices`} className={styles.addDevice}>
            {t('space.control.noControllerAdd')}
          </Link>
        </p>
      ) : (
        here.map(device => <PlanPanel key={device.id} device={device} mayManage={mayManage} />)
      )}

      {/* The moves, the manual targets and the alarm rules are all absent for
          somebody who may only write lines, which leaves a tab that looks half
          drawn - so it says whose they are and that what is set is still shown. */}
      {!mayManage && mayLog && here.length > 0 ? <p className={`mono ${styles.role}`}>{t('space.control.youMayLog')}</p> : null}

      {here.length > 0 ? (
        <nav className={styles.below} aria-label={t('space.control.belowLabel')}>
          <Link to={`/spaces/${spaceId}/control/targets`} className={`${ui.button} ${styles.belowButton}`}>
            {t('space.control.targets')}
          </Link>
          <Link to={`/spaces/${spaceId}/control/alarms`} className={`${ui.button} ${styles.belowButton}`}>
            {t('space.control.advanced')}
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
          </Link>
          <p className={`mono ${styles.advancedNote}`}>
            <Link to={`/spaces/${spaceId}/control/alarms`}>{t('space.control.advancedAlarms')}</Link>
            {' · '}
            <Link to={`/spaces/${spaceId}/devices`}>{t('space.control.advancedSockets')}</Link>
          </p>
        </nav>
      ) : null}
    </div>
  );
}
