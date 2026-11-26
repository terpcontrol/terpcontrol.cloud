import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { AlarmRule, Device } from '@fg2/shared-types/v1';
import { restsInGermination, watchNow } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { useAlarmRulesOf } from '@/api/alarm-rules';
import { controlPath } from '@/app/places';
import type { Translate } from '@/i18n/i18n';
import { durationLabel } from '@/ui/age';
import ui from '@/ui/ui.module.css';
import { boundLabel, ruleTitle } from '@/screens/control/alarms/rules';
import styles from './Start.module.css';

/** How many rules the card names before it counts the rest. */
const NAMED = 3;

/**
 * One rule as the card says it: its name, and where it trips - "über 30 °C",
 * "länger als 2 Std" for an output, nothing for the offline rule every device
 * carries. The stage's "Zu feucht" that rests while its device germinates says
 * it rests rather than promising a line it does not watch, and one that warns
 * at germination's own line says that line.
 */
const lineOf = (t: Translate, rule: AlarmRule, device: Device | undefined): { name: string; bound: string } => {
  const workmode = device?.configuration?.workmode;
  const watch = watchNow(rule, workmode);
  const resting = device !== undefined && restsInGermination(rule, workmode, device.control?.germinationChoices);
  const bound = resting
    ? t('alarms.meta.restsInGermination')
    : rule.origin === 'always'
      ? ''
      : watch.kind === 'output_running'
        ? rule.forSeconds > 0
          ? t('alarms.bound.longer', { duration: durationLabel(rule.forSeconds) })
          : ''
        : boundLabel(t, watch);
  return { name: ruleTitle(t, rule), bound };
};

/**
 * What watches over the place, master's summary as a list: each rule that is
 * switched on with where it trips, three at most and then how many more, and
 * "Ändern ›" to Steuerung's alarms for whoever may change them. Each device
 * keeps its own offline rule, and two of them are one promise to the grower,
 * so a line is said once. Drawn once the rules are read: an unread list is no
 * "Noch kein Alarm".
 */
export function Alarms({ spaceId, devices, mayManage }: { spaceId: string; devices: Device[]; mayManage: boolean }) {
  const { t } = useTranslation();
  const rules = useAlarmRulesOf(devices.map(device => device.id));
  if (rules.counts.size === 0) return null;
  const lines = [...rules.rules.values()]
    .filter(rule => rule.enabled)
    .map(rule =>
      lineOf(
        t,
        rule,
        devices.find(device => device.id === rule.deviceId),
      ),
    )
    .filter((line, index, all) => all.findIndex(other => other.name === line.name && other.bound === line.bound) === index);
  const title = t('start.alarms.title');

  return (
    <section className={ui.panel} aria-labelledby="start-alarms">
      <header className={styles.summaryHead}>
        <h2 className={ui.cardHeading} id="start-alarms">
          {title}
        </h2>
        {mayManage ? (
          <Link to={controlPath(spaceId, 'alarms')} className={styles.change}>
            {t('start.change')} ›<span className={ui.visuallyHidden}>{`: ${title}`}</span>
          </Link>
        ) : null}
      </header>
      {lines.length === 0 ? (
        <p className={styles.cardText}>{t('start.alarms.none')}</p>
      ) : (
        <ul className={styles.alarms}>
          {lines.slice(0, NAMED).map(line => (
            <li key={`${line.name} ${line.bound}`}>
              <span className={styles.alarmName}>{line.name}</span>
              {line.bound ? <span className={styles.alarmBound}>{line.bound}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {lines.length > NAMED ? <p className={styles.cardText}>{t('start.alarms.more', { count: lines.length - NAMED })}</p> : null}
    </section>
  );
}
