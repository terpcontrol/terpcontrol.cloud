import { ChevronRight } from 'lucide-react';
import type { DateTime } from 'luxon';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CardSetpoint, Device, Metric, OverviewTargets } from '@fg2/shared-types/v1';
import { useDevicePlans } from '@/api/plans';
import { controlPath } from '@/app/places';
import type { Translate } from '@/i18n/i18n';
import { awaitingClimate, darkReasonOf } from '@/ui/climate-hardware';
import { targetWithUnit } from '@/ui/units';
import { offsetOf } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import { fanSummaryOf, plugSummaryOf } from '@/screens/control/devices/own-summary';
import { holdsHumidity, storedShapeOf } from '@/screens/control/targets/day-night';
import { lightWindowOf, setpointOf, type HumidifierHold } from './place';
import { planLineOf } from './plan-line';
import styles from './Start.module.css';

const halfOf = (row: CardSetpoint[], withCo2: boolean, withHumidity: boolean): string[] =>
  (['temperature', ...(withHumidity ? ['humidity'] : []), ...(withCo2 ? ['co2'] : [])] as Metric[]).flatMap(metric => {
    const value = setpointOf(row, metric)?.value;
    if (value == null) return [];
    return [metric === 'co2' ? `CO₂ ${targetWithUnit(value, metric)}` : targetWithUnit(value, metric)];
  });

/**
 * What a place is set to, in one line: "Tag 25 °C · 60 % · Nacht 21 °C ·
 * 55 %". CO₂ stands with the day because it is only dosed by day. Where the
 * device has no day and night the line is named by what it holds - a drying
 * room's, a germination's, the one climate held round the clock - and a smart
 * socket or a lamp says its own settings. Each part stays on one line; empty
 * where nothing is set.
 */
const targetsLine = (
  t: Translate,
  {
    targets,
    device,
    humidifierHold,
    offset,
  }: { targets: OverviewTargets | null; device: Device | null; humidifierHold: HumidifierHold | null; offset: number },
): string[] => {
  const own = device ? (plugSummaryOf(t, device, offset) ?? fanSummaryOf(t, device)) : null;
  if (own) return own.map(row => [row.label, ...row.parts].join(' '));
  if (!targets) return [];

  const shape = storedShapeOf(device);
  const regime = shape?.regime ?? 'cycle';
  const humidity = shape ? holdsHumidity(shape) : true;
  const named = (label: string, parts: string[]): string[] => (parts.length > 0 ? [`${label} ${parts.join(' · ')}`] : []);
  if (regime === 'drying' || regime === 'germination') {
    const held = regime === 'germination' && humidifierHold ? [targetWithUnit(humidifierHold.target, 'humidity')] : [];
    return named(t(`cockpit.targets.${regime}`), [...halfOf(targets.night, false, humidity), ...held]);
  }
  if (regime === 'always') return named(t('cockpit.targets.roundTheClock'), halfOf(targets.day, true, humidity));
  if (regime === 'never') return named(t('cockpit.targets.roundTheClock'), halfOf(targets.night, false, humidity));

  return [
    ...named(t('cockpit.targets.day'), halfOf(targets.day, true, humidity)),
    ...named(t('cockpit.targets.night'), halfOf(targets.night, false, humidity)),
  ];
};

/** "Licht 06:00 bis 24:00 · Grenze 65 %": when the lamp is on and how bright it may get, for a reader who cannot open Steuerung to see. */
const lightLine = (t: Translate, device: Device | null, now: DateTime, zone: string | null): string | null => {
  const light = lightWindowOf(device, now, zone);
  const dark = darkReasonOf(device);
  if (!light) return dark && dark !== 'off' ? `${t('cockpit.targets.light')} ${t(`cockpit.light.dark.${dark}`)}` : null;
  const window = light.always
    ? t('cockpit.light.always')
    : light.never
      ? t('cockpit.light.never')
      : t('start.targets.window', { on: light.on, off: light.off });
  return [`${t('cockpit.targets.light')} ${window}`, light.limit < 100 && !light.never ? t('start.targets.limit', { percent: light.limit }) : null]
    .filter(Boolean)
    .join(' · ');
};

/**
 * The targets on Start: a summary and the way to Steuerung, where they are
 * changed - Start changes no setting. A running plan says where it stands on
 * the same row, and a paused one that it is paused. With the device silent
 * the row says that changing them works all the same. A reader who may not
 * steer the place is shown the summary and the light as a card, and - where
 * somebody else could - who can change them.
 */
export function Targets({
  spaceId,
  name,
  targets,
  device,
  humidifierHold,
  offline,
  mayManage,
  guest,
  now,
}: {
  spaceId: string;
  name: string;
  targets: OverviewTargets | null;
  device: Device | null;
  humidifierHold: HumidifierHold | null;
  offline: boolean;
  mayManage: boolean;
  /** Let in by the place's owner, who is the one to ask for a change. */
  guest: boolean;
  now: DateTime;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const plan = useDevicePlans(mayManage && device?.control ? [device.id] : []).plans[0];
  const planLine = plan ? planLineOf(t, plan, now) : null;
  const own = device?.type === 'plug' || device?.type === 'light';
  const title = t(own ? 'ownPanel.title' : 'cockpit.targets.title');
  const parts = targetsLine(t, { targets, device, humidifierHold, offset: offsetOf(now, zone) });
  const line =
    parts.length > 0 ? (
      parts.map((part, index) => (
        <Fragment key={part}>
          {index > 0 ? ' · ' : null}
          <span>{part}</span>
        </Fragment>
      ))
    ) : (
      <span>
        {t(
          darkReasonOf(device) === 'off'
            ? 'cockpit.targets.controlOff'
            : device && awaitingClimate(device)
              ? 'cockpit.targets.awaiting'
              : 'cockpit.targets.none',
        )}
      </span>
    );

  if (!mayManage) {
    const light = lightLine(t, device, now, zone);
    return (
      <section className={styles.card} aria-labelledby="start-targets">
        <h2 className={styles.cardTitle} id="start-targets">
          {title}
        </h2>
        <span className={`mono ${styles.parts}`}>{line}</span>
        {light ? <span className={`mono ${styles.cardText}`}>{light}</span> : null}
        {guest ? <span className={styles.cardText}>{t('start.targets.whoChanges', { name })}</span> : null}
      </section>
    );
  }

  return (
    <Link to={controlPath(spaceId)} className={styles.row}>
      {offline ? (
        <span className={styles.rowText} data-tone="brand">
          {t('start.targets.changeOffline')}
          <span className={styles.rowNote}>{t('start.targets.offlineNote')}</span>
        </span>
      ) : (
        <span className={styles.rowText}>
          {title}
          <span className={styles.rowNote}>{line}</span>
          {planLine ? <span className={styles.rowNote}>{`${t('planLine.plan')} ${planLine}`}</span> : null}
        </span>
      )}
      <ChevronRight size={20} strokeWidth={2} className={styles.chevron} aria-hidden />
    </Link>
  );
}
