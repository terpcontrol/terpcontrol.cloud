import { ChevronRight } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CardSetpoint, Device, Metric, OverviewTargets } from '@fg2/shared-types/v1';
import { useDevicePlans } from '@/api/plans';
import { controlPath } from '@/app/places';
import type { Translate } from '@/i18n/i18n';
import { awaitingClimate, darkReasonOf } from '@/ui/climate-hardware';
import { factsOf } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';
import { targetWithUnit } from '@/ui/units';
import { offsetOf } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import { fanSummaryOf, plugSummaryOf } from '@/screens/control/devices/own-summary';
import { holdsHumidity, storedShapeOf } from '@/screens/control/targets/day-night';
import { lightWindowOf, setpointOf, type HumidifierHold } from './place';
import { planLineOf } from './plan-line';
import styles from './Start.module.css';
import ui from '@/ui/ui.module.css';

const halfOf = (row: CardSetpoint[], withCo2: boolean, withHumidity: boolean): string[] =>
  (['temperature', ...(withHumidity ? ['humidity'] : []), ...(withCo2 ? ['co2'] : [])] as Metric[]).flatMap(metric => {
    const value = setpointOf(row, metric)?.value;
    if (value == null) return [];
    return [metric === 'co2' ? `CO₂ ${targetWithUnit(value, metric)}` : targetWithUnit(value, metric)];
  });

/**
 * What a place is set to: "Tag 25 °C · 60 % · Nacht 21 °C · 55 %", as the
 * groups it is made of - a half of the day with its figures, the name bound to
 * the first. CO₂ stands with the day because it is only dosed by day. Where
 * the device has no day and night the group is named by what it holds - a
 * drying room's, a germination's, the one climate held round the clock - and a
 * smart socket or a lamp says its own settings. Empty where nothing is set.
 */
const targetsLine = (
  t: Translate,
  {
    targets,
    device,
    humidifierHold,
    offset,
  }: { targets: OverviewTargets | null; device: Device | null; humidifierHold: HumidifierHold | null; offset: number },
): string[][] => {
  const own = device ? (plugSummaryOf(t, device, offset) ?? fanSummaryOf(t, device)) : null;
  if (own) return own.map(row => [[row.label, ...row.parts].join(' ')]);
  if (!targets) return [];

  const shape = storedShapeOf(device);
  const regime = shape?.regime ?? 'cycle';
  const humidity = shape ? holdsHumidity(shape) : true;
  const named = (label: string, parts: string[]): string[][] => (parts.length > 0 ? [[`${label} ${parts[0]}`, ...parts.slice(1)]] : []);
  if (regime === 'drying' || regime === 'germination') {
    const held = regime === 'germination' && humidifierHold ? [targetWithUnit(humidifierHold.target, 'humidity')] : [];
    return named(t(`start.targets.${regime}`), [...halfOf(targets.night, false, humidity), ...held]);
  }
  if (regime === 'always') return named(t('start.targets.roundTheClock'), halfOf(targets.day, true, humidity));
  if (regime === 'never') return named(t('start.targets.roundTheClock'), halfOf(targets.night, false, humidity));

  return [
    ...named(t('start.targets.day'), halfOf(targets.day, true, humidity)),
    ...named(t('start.targets.night'), halfOf(targets.night, false, humidity)),
  ];
};

/** "Licht 06:00 bis 24:00 · Grenze 65 %": when the lamp is on and how bright it may get, for a reader who cannot open Steuerung to see. */
const lightLine = (t: Translate, device: Device | null, now: DateTime, zone: string | null): string | null => {
  const light = lightWindowOf(device, now, zone);
  const dark = darkReasonOf(device);
  if (!light) return dark && dark !== 'off' ? `${t('start.targets.light')} ${t(`start.light.dark.${dark}`)}` : null;
  const window = light.always
    ? t('start.light.always')
    : light.never
      ? t('start.light.never')
      : t('start.targets.window', { on: light.on, off: light.off });
  return [`${t('start.targets.light')} ${window}`, light.limit < 100 && !light.never ? t('start.targets.limit', { percent: light.limit }) : null]
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
  const title = t(own ? 'ownPanel.title' : 'start.targets.title');
  const groups = targetsLine(t, { targets, device, humidifierHold, offset: offsetOf(now, zone) });
  // A half of the day stays together for as long as it fits a line, and no line ends on the dot between two figures.
  const line =
    groups.length > 0 ? (
      <Facts facts={groups.map(group => (group.length > 1 ? <Facts key={group[0]} facts={group} /> : group[0]))} />
    ) : (
      <span>
        {t(
          darkReasonOf(device) === 'off'
            ? 'start.targets.controlOff'
            : device && awaitingClimate(device)
              ? 'start.targets.awaiting'
              : 'start.targets.none',
        )}
      </span>
    );

  if (!mayManage) {
    const light = lightLine(t, device, now, zone);
    return (
      <section className={`${ui.panel} ${styles.card}`} aria-labelledby="start-targets">
        <h2 className={`${ui.cardHeading} ${styles.cardTitle}`} id="start-targets">
          {title}
        </h2>
        <span className="mono">{line}</span>
        {light ? <Facts className={`mono ${styles.cardText}`} facts={factsOf(light)} /> : null}
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
