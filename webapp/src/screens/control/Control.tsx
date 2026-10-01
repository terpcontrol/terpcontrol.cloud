import { Bell, CalendarRange, ChevronRight, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { CONTROL_PAGES, controlPath, type ControlPage } from '@/app/places';
import type { Device, Plan } from '@fg2/shared-types/v1';
import { useAlarmRulesOf } from '@/api/alarm-rules';
import { useDevices } from '@/api/devices';
import { useDevicePlans } from '@/api/plans';
import { climateLanding } from '@/ui/climate-hardware';
import { LoadFailed, Waiting } from '@/ui/PageState';
import { useMayLogIn, useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { Alarms } from './alarms/Alarms';
import { PlanPanel } from './PlanPanel';
import { Targets } from './targets/Targets';
import styles from './Control.module.css';

const isSub = (value: string | null): value is ControlPage => (CONTROL_PAGES as readonly string[]).includes(value ?? '');

/**
 * Steuerung for one place: what the place is held at, what watches over it,
 * and what - if anything - is setting those targets by itself.
 *
 * It opens on the targets, because that is what somebody with one tent comes
 * here to change, and a sentence about a plan nobody wrote read as "this tent
 * is not being steered". A plan that is running is the exception: it moves the
 * targets on its own clock and may be waiting for an answer, so then the tab
 * opens on the plan and the targets are one row below it. Under the targets
 * stand two rows, the alarms and the way to a plan, each a page of its own in
 * the address, so an alert can link to the rule it came from and a reload
 * lands where it was.
 *
 * A plan belongs to a device and not to the place, because what a step writes
 * is that device's own configuration document - so a tent with two controllers
 * in it has two plans, and each is drawn with the name of the device it runs.
 * A tent with nothing in it says so and points at the one thing that would
 * change that: claiming a device into the tent.
 */
export function Control({ spaceId, sub }: { spaceId: string; sub: string | null }) {
  const { t } = useTranslation();
  // Everything on this tab and on the pages below it writes to a device
  // standing here, which the ADR's table puts at `manage` - so the question is
  // about this place and not about the session.
  const mayManage = useMayManage(spaceId);
  const devices = useDevices();
  const here = devices.data?.items.filter(device => device.spaceId === spaceId) ?? [];
  const plans = useDevicePlans(here.map(device => device.id));
  const planFirst = plans.plans.some(plan => plan.state.status === 'running');

  if (sub !== null && !isSub(sub)) return <Navigate to={controlPath(spaceId)} replace />;

  if (devices.isPending) return <Waiting lines={4} />;
  if (!devices.data) return <LoadFailed retry={() => void devices.refetch()} />;

  if (here.length === 0) {
    return (
      <div className={styles.page}>
        <p className={`${ui.cardDashed} ${ui.note}`}>
          {t('space.control.noController')}{' '}
          <Link to="/claim" className={styles.addDevice}>
            {t('space.control.noControllerAdd')}
          </Link>
        </p>
      </div>
    );
  }

  if (sub === 'alarms') return <Alarms spaceId={spaceId} devices={here} mayManage={mayManage} back={planFirst ? 'plan' : 'targets'} />;
  if (sub === 'plan') return planFirst ? <Navigate to={controlPath(spaceId)} replace /> : <PlanPage spaceId={spaceId} here={here} />;
  // Whether the tab opens on the plan is not guessed while the plans are on
  // their way: drawing the targets first and swapping them for a running plan
  // a moment later would put the page out from under a finger.
  if (sub === null && plans.isPending) return <Waiting lines={4} />;
  if (sub === null && planFirst) return <PlanPage spaceId={spaceId} here={here} first />;

  return (
    <div className={styles.page}>
      <Targets spaceId={spaceId} devices={here} mayManage={mayManage} crumb={planFirst} />
      <Rows spaceId={spaceId} here={here} plans={planFirst ? null : plans.plans} />
    </div>
  );
}

/**
 * The plans of everything standing here. It is what the tab opens on while one
 * of them is running, with the targets and the alarms one row below; otherwise
 * it is the page the last row under the targets leads to, and leads back.
 */
function PlanPage({ spaceId, here, first = false }: { spaceId: string; here: Device[]; first?: boolean }) {
  const { t } = useTranslation();
  const mayManage = useMayManage(spaceId);
  const mayLog = useMayLogIn(spaceId);

  return (
    <div className={styles.page}>
      <header className={ui.subhead}>
        <span className="label">{t('space.control.title')}</span>
        {first ? null : (
          <Link to={controlPath(spaceId)} className={`mono ${ui.headLink}`}>
            {t('space.control.backToTargets')}
          </Link>
        )}
      </header>

      {/* Where a plan would write is the device's question and not the tent's,
          so it is asked here per device and handed down: a tent holding a
          controller and a lamp draws a plan for the one and says so about the
          other. It is handed down in all three of its states, because the
          controller whose document has not arrived is neither of the two the
          panel used to draw and is the one a step must not be written for. */}
      {here.map(device => (
        <PlanPanel key={device.id} device={device} mayManage={mayManage} landing={climateLanding(device)} />
      ))}

      {/* The moves, the targets and the alarm rules are all absent for
          somebody who may only write lines, which leaves a tab that looks half
          drawn - so it says whose they are and that what is set is still shown. */}
      {!mayManage && mayLog ? <p className={`mono ${styles.role}`}>{t('space.control.youMayLog')}</p> : null}

      {first ? <Rows spaceId={spaceId} here={here} plans={null} targets /> : null}
    </div>
  );
}

/**
 * The rows under the targets - or under a running plan - that lead to the
 * other pages of the tab, each saying what is behind it: how many alarms are
 * watching, and whether a plan exists and what it is doing.
 *
 * The plan row is left out where no plan is or could be: a place holding only
 * a plug or a lamp has no climate for a step to write.
 */
function Rows({ spaceId, here, plans, targets = false }: { spaceId: string; here: Device[]; plans: Plan[] | null; targets?: boolean }) {
  const { t } = useTranslation();
  const rules = useAlarmRulesOf(here.map(device => device.id));
  const on = [...rules.rules.values()].filter(rule => rule.enabled).length;
  const plan = plans?.[0] ?? null;
  const planned = plans !== null && (plan !== null || here.some(device => climateLanding(device) !== 'nowhere'));

  return (
    <nav aria-label={t('space.control.belowLabel')}>
      <ul className={ui.group}>
        {targets ? (
          <Row
            to={controlPath(spaceId, 'targets')}
            icon={SlidersHorizontal}
            title={t('space.control.targets')}
            line={t('space.control.targetsLine')}
          />
        ) : null}
        <Row
          to={controlPath(spaceId, 'alarms')}
          icon={Bell}
          title={t('space.control.alarms')}
          line={rules.isPending ? null : t('space.control.alarmsOn', { count: on })}
        />
        {planned ? (
          <Row
            to={controlPath(spaceId, 'plan')}
            icon={CalendarRange}
            title={plan ? t('space.control.planNamed', { name: plan.name }) : t('space.control.planRow')}
            line={plan ? t(`space.control.status.${plan.state.status}`) : t('space.control.planRowLine')}
          />
        ) : null}
      </ul>
    </nav>
  );
}

function Row({ to, icon: Icon, title, line }: { to: string; icon: LucideIcon; title: string; line: string | null }) {
  return (
    <li>
      <Link to={to} className={styles.door}>
        <Icon size={18} strokeWidth={1.75} aria-hidden className={styles.doorIcon} />
        <span className={styles.doorText}>
          <span className={styles.doorTitle}>{title}</span>
          {line ? <span className={`mono ${styles.doorLine}`}>{line}</span> : null}
        </span>
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden className={styles.doorChevron} />
      </Link>
    </li>
  );
}
