import { ChevronRight } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CardSetpoint, Device, Metric, OverviewTargets } from '@fg2/shared-types/v1';
import { useDevicePlans } from '@/api/plans';
import { controlPath } from '@/app/places';
import type { Translate } from '@/i18n/i18n';
import { fieldValue } from '@/ui/advanced/field-values';
import { awaitingClimate, darkReasonOf } from '@/ui/climate-hardware';
import { factsOf } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';
import { targetWithUnit } from '@/ui/units';
import { offsetOf } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import { plugSummaryOf } from '@/screens/control/devices/own-summary';
import { usePlanWords } from '@/screens/control/plan-labels';
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
 * smart socket or a lamp says its own settings, a fan at a fixed speed its
 * speeds by day and by night. Empty where nothing is set.
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
  const speeds = fixedSpeedsOf(device);
  if (speeds) return [[`${t('start.targets.day')} ${speeds.day} %`], [`${t('start.targets.night')} ${speeds.night} %`]];
  const own = device ? plugSummaryOf(t, device, offset) : null;
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

/** An AIR fan at a fixed speed, which follows no target: how fast it runs by day and by night. */
const fixedSpeedsOf = (device: Device | null): { day: number; night: number } | null => {
  if (device?.type !== 'fan' || fieldValue(device, 'fanMode') !== 'fixed') return null;
  const day = fieldValue(device, 'fixedDay');
  const night = fieldValue(device, 'fixedNight');
  return typeof day === 'number' && typeof night === 'number' ? { day, night } : null;
};

/**
 * "Licht 06:00 bis 24:00 · Grenze 65 %": when the lamp is on and how bright it may get, for a reader who cannot open
 * Steuerung to see. Under a card titled "Licht" - a lamp alone - the word is not said again (`named` false).
 */
const lightLine = (t: Translate, device: Device | null, now: DateTime, zone: string | null, named = true): string | null => {
  const light = lightWindowOf(device, now, zone);
  const dark = darkReasonOf(device);
  const word = (said: string) => (named ? `${t('start.targets.light')} ${said}` : said);
  if (!light) return dark && dark !== 'off' ? word(t(`start.light.dark.${dark}`)) : null;
  const window = light.always
    ? t('start.light.always')
    : light.never
      ? t('start.light.never')
      : t('start.targets.window', { on: light.on, off: light.off });
  return [word(window), light.limit < 100 && !light.never ? t('start.targets.limit', { percent: light.limit }) : null].filter(Boolean).join(' · ');
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
  usePlanWords([plan]);
  const planLine = plan ? planLineOf(t, plan, now) : null;
  const groups = targetsLine(t, { targets, device, humidifierHold, offset: offsetOf(now, zone) });
  // A lamp alone aims at no climate: what it is set to is its light, never "no targets yet", under a card called so.
  const alone = groups.length === 0 && device?.type === 'light';
  const light = lightLine(t, device, now, zone, !alone);
  const lamp = alone ? light : null;
  // Named by what it holds: a socket its settings, a lamp its light, a fan at a fixed speed its speed, the rest targets.
  const title = alone
    ? t('start.targets.light')
    : fixedSpeedsOf(device)
      ? t('fanSettings.speeds')
      : t(device?.type === 'plug' || device?.type === 'light' ? 'ownPanel.title' : 'start.targets.title');
  // A half of the day stays together for as long as it fits a line, and no line ends on the dot between two figures.
  const line =
    groups.length > 0 ? (
      <Facts facts={groups.map(group => (group.length > 1 ? <Facts key={group[0]} facts={group} /> : group[0]))} />
    ) : lamp ? (
      <Facts facts={factsOf(lamp)} />
    ) : (
      <span>
        {t(
          darkReasonOf(device) === 'off' ? 'control.state.off' : device && awaitingClimate(device) ? 'start.targets.awaiting' : 'start.targets.none',
        )}
      </span>
    );

  if (!mayManage) {
    return (
      <section className={`${ui.panel} ${styles.card}`} aria-labelledby="start-targets">
        <h2 className={`${ui.cardHeading} ${styles.cardTitle}`} id="start-targets">
          {title}
        </h2>
        <span>{line}</span>
        {light && !lamp ? <Facts className={styles.cardText} facts={factsOf(light)} /> : null}
        {guest ? <span className={styles.cardText}>{t('start.targets.whoChanges', { name })}</span> : null}
      </section>
    );
  }

  return (
    <Link to={controlPath(spaceId)} className={ui.rowCard}>
      {offline ? (
        // What the device was left on is still said - "Regelung aus" above all, which the offline note does not undo.
        <span className={styles.rowText} data-tone="brand">
          {t('start.targets.changeOffline')}
          <span className={styles.rowNote}>{line}</span>
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
