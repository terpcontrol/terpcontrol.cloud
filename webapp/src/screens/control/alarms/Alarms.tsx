import { CloudOff, Droplets, DropletOff, Refrigerator, ThermometerSnowflake, ThermometerSun, type LucideIcon } from 'lucide-react';
import { useAccountMe } from '@/api/account';
import { DateTime } from 'luxon';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { controlPath } from '@/app/places';
import type { AlarmRule, Device, Me, OverviewGrow } from '@fg2/shared-types/v1';
import { restsInGermination, watchNow } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { useAlarmRulesOf, useCreateAlarmRule, useDeviceAlarmRules, useRemoveAlarmRule, useUpdateAlarmRule } from '@/api/alarm-rules';
import { useDeviceCommand } from '@/api/commands';
import { useSpaceOverview } from '@/api/spaces';
import type { Translate } from '@/i18n/i18n';
import { useLog } from '@/log/log-context';
import { targetWithUnit } from '@/ui/units';
import { severityReaches } from '@/screens/notifications/reach';
import { durationLabel } from '@/ui/age';
import { factsOf } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';
import { Help } from '@/ui/Help';
import { LoadFailed, RefreshFailed, Refused, Waiting } from '@/ui/PageState';
import { Switch } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
import { maintenanceQuiet } from '@/ui/maintenance';
import { useNow } from '@/ui/useNow';
import { clock, zoneOf } from '@/ui/zone';
import { ByDevice, NothingHere } from '../ByDevice';
import { alarmsLine } from '../rows';
import { RuleSheet } from './RuleSheet';
import { useSilence } from './use-silence';
import { ruleFor, templateBody, templateName, templatesFor, type AlarmTemplate, type TemplateKey } from './templates';
import { boundLabel, groupRules, missingSensor, ruleTitle, watchable, watchLabel, willTell } from './rules';
import { NotifyNotice } from '@/screens/notifications/NotifyNotice';
import styles from './Alarms.module.css';
import { serverNow } from '@/api/clock';

/**
 * The alarm rules of a place, under Steuerung › Alarme.
 *
 * A rule belongs to the device that measures what it watches, so each device
 * has its list (`ByDevice`), and the device holding a rule a link names is
 * unfolded for it. Within a list the rules stand by where they came from: the
 * stage's are rewritten at the next stage, the cloud's own are there for every
 * device, the firmware's were asked for by the hardware, and the last group is
 * what was written here. A device is listed when it holds a rule or one could
 * be written for it.
 *
 * Nothing is decided on this side: whether a rule stands triggered or silenced
 * are the server's answers. What the page adds is what the account's routing
 * would do with the rule, once the account has answered; the demo has none.
 */
export function Alarms({ spaceId, devices, mayManage }: { spaceId: string; devices: Device[]; mayManage: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const overview = useSpaceOverview(spaceId);
  const me = useAccountMe();
  const [params] = useSearchParams();

  // The same reads the lists below make, asked once here so that a device
  // nobody could write a rule for is still listed while it holds one.
  const held = useAlarmRulesOf(devices.map(device => device.id));
  const holding = new Set([...held.rules.values()].map(rule => rule.deviceId));
  const watched = devices.filter(device => watchable(device) || holding.has(device.id));
  const grow = overview.data?.grows[0] ?? null;
  // An account no alarm reaches at all is told so once, over the list, with
  // the one-tap fix - rather than "erreicht dich nicht" under every card.
  const reachesNoOne = me.data !== undefined && !(['critical', 'warning'] as const).some(severity => severityReaches(me.data!, severity));

  return (
    <div className={ui.stack4}>
      {reachesNoOne && watched.length > 0 ? <NotifyNotice /> : null}

      {watched.length === 0 && held.isPending ? (
        <Waiting lines={3} />
      ) : watched.length === 0 ? (
        <NothingHere to="/claim" where={t('space.control.noControllerAdd')}>
          {t('alarms.noController')}
        </NothingHere>
      ) : (
        <ByDevice
          devices={watched}
          unfolded={held.rules.get(params.get('rule') ?? '')?.deviceId ?? null}
          line={device =>
            held.isPending
              ? null
              : alarmsLine(
                  t,
                  [...held.rules.values()].filter(rule => rule.deviceId === device.id),
                )
          }
        >
          {device => (
            <DeviceRules
              device={device}
              grow={grow}
              me={me.data}
              toldAbove={reachesNoOne}
              mayManage={mayManage}
              highlighted={params.get('rule')}
              now={now}
            />
          )}
        </ByDevice>
      )}

      {/* A silence stops the announcement and maintenance stops the engine: which is which is one tap away, not a paragraph. */}
      {watched.length > 0 ? (
        <p className={`mono ${styles.quietLine}`}>
          {t('alarms.quietLine')}
          <Help topic="alarmQuiet" />
        </p>
      ) : null}
    </div>
  );
}

interface DeviceRulesProps {
  device: Device;
  grow: OverviewGrow | null;
  /** The account, once it has answered; until then nothing is said about where a routed rule goes. */
  me: Me | undefined;
  /** Whether the page already says, over the list, that no alarm reaches anybody. */
  toldAbove: boolean;
  mayManage: boolean;
  /** The rule an alert linked to, which is scrolled to and marked. */
  highlighted: string | null;
  now: DateTime;
}

/** One device's rules, in their groups, with the row that writes a new one under them. */
function DeviceRules({ device, grow, me, toldAbove, mayManage, highlighted, now }: DeviceRulesProps) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const rules = useDeviceAlarmRules(device.id);
  const update = useUpdateAlarmRule(device.id);
  const [open, setOpen] = useState<AlarmRule | 'new' | null>(null);
  // The switch answers with what it did, and takes it back: a rule switched off by a slip of the thumb watches nothing.
  const toggle = (rule: AlarmRule, enabled: boolean) =>
    update.mutate(
      { ruleId: rule.id, body: { enabled } },
      {
        onSuccess: () =>
          tell({
            label: t(enabled ? 'alarms.told.on' : 'alarms.told.off', { name: ruleTitle(t, rule) }),
            undo: () => update.mutateAsync({ ruleId: rule.id, body: { enabled: !enabled } }),
            undone: t(enabled ? 'alarms.told.off' : 'alarms.told.on', { name: ruleTitle(t, rule) }),
            from: `rule-${rule.id}`,
          }),
      },
    );
  // The rule a template has just written, marked like a linked one so the eye
  // finds where the tap went: the template leaves its place, the rule takes one.
  const [made, setMade] = useState<string | null>(null);

  // An alert's "Edit rule" lands here with the rule named, and is taken at its
  // word: the rule opens, once, for whoever may change it.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    const linked = rules.data?.items.find(rule => rule.id === highlighted);
    if (!mayManage || !linked || openedFor.current === linked.id) return;
    openedFor.current = linked.id;
    setOpen(linked);
  }, [highlighted, mayManage, rules.data]);

  if (rules.isPending) return <Waiting lines={3} />;
  if (!rules.data) return <LoadFailed retry={() => void rules.refetch()} />;

  // The name of the stage's group: the preset the grow stands on where the
  // catalogue has a name for it, otherwise the stage itself - and the bare
  // word where nothing grows here yet, because the rules are still the stage's.
  const presetName = grow?.preset ? t(`grow.presetName.${grow.preset}`, { defaultValue: '' }) : '';
  const stageName = presetName || (grow?.stage ? t(`home.stage.${grow.stage}`) : '');
  const groups = groupRules(rules.data.items);

  return (
    <div className={styles.device}>
      <RefreshFailed failedAt={rules.isError ? rules.dataUpdatedAt : null} now={now} />

      {/* Over the rules rather than under them: while this stands, every switch
          and every triggered dot below it is drawn over an engine that is
          refusing to turn this device's rules at all. */}
      <InMaintenance device={device} me={me} mayManage={mayManage} now={now} />

      {groups.map(group => (
        <div key={group.origin} className={ui.stack2}>
          <header className={styles.groupHead}>
            <span className="label">
              {group.origin === 'preset'
                ? stageName
                  ? t('alarms.group.presetOf', { name: stageName })
                  : t('alarms.group.presetNone')
                : t(`alarms.group.${group.origin}`)}
              {group.origin === 'preset' ? <Help topic="presetRules" /> : group.origin === 'always' ? <Help topic="offlineRule" /> : null}
            </span>
            {group.origin === 'preset' ? <span className={`mono ${styles.groupAside}`}>{t('alarms.group.presetAside')}</span> : null}
          </header>
          <ul className={ui.group}>
            {group.rules.map(rule => (
              <RuleCard
                key={rule.id}
                rule={rule}
                device={device}
                me={me}
                toldAbove={toldAbove}
                mayManage={mayManage}
                highlighted={rule.id === highlighted || rule.id === made}
                busy={update.isPending}
                now={now}
                // Among all the device's rules, whatever group each stands in.
                twin={rules.data.items.some(other => other.id !== rule.id && ruleTitle(t, other) === ruleTitle(t, rule))}
                onOpen={() => setOpen(rule)}
                onToggle={enabled => toggle(rule, enabled)}
              />
            ))}
          </ul>
        </div>
      ))}

      <Refused error={update.error} />

      {mayManage ? <Templates device={device} rules={rules.data.items} onMade={setMade} /> : null}

      {mayManage && watchable(device) ? (
        <button type="button" className={`${ui.cardDashed} ${styles.add}`} onClick={() => setOpen('new')}>
          {t('alarms.add')}
        </button>
      ) : null}

      {open ? <RuleSheet device={device} rule={open === 'new' ? null : open} me={me} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

const TEMPLATE_ICON: Record<TemplateKey, LucideIcon> = {
  warm: ThermometerSun,
  cold: ThermometerSnowflake,
  humid: Droplets,
  dry: DropletOff,
  co2Empty: CloudOff,
  running: Refrigerator,
};

/**
 * Too warm, too cold, too humid, too dry - and where the hardware has the
 * part, an empty CO2 cylinder and a compressor that does not stop: each one
 * tap from a rule. A template whose rule the device already has is not
 * offered again, and once all are there the offer goes.
 */
function Templates({ device, rules, onMade }: { device: Device; rules: AlarmRule[]; onMade: (ruleId: string) => void }) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const create = useCreateAlarmRule(device.id);
  const remove = useRemoveAlarmRule(device.id);
  const [making, setMaking] = useState<TemplateKey | null>(null);
  const offered = templatesFor(device).filter(template => ruleFor(rules, template) === null);

  if (offered.length === 0) return null;

  const make = (template: AlarmTemplate) => {
    setMaking(template.key);
    create.mutate(templateBody(template), {
      onSuccess: rule => {
        onMade(rule.id);
        tell({
          label: t('alarms.told.made', { name: ruleTitle(t, rule) }),
          undo: () => remove.mutateAsync(rule.id),
          undone: t('log.noMore', { what: ruleTitle(t, rule) }),
        });
      },
      onSettled: () => setMaking(null),
    });
  };

  return (
    <div className={styles.templates}>
      <span className="label">
        {t('alarms.template.label')}
        <Help topic="alarmTemplates" />
      </span>
      <ul className={styles.templateList}>
        {offered.map(template => {
          const Icon = TEMPLATE_ICON[template.key];
          const { watch } = template;
          const length = durationLabel(template.forMinutes * 60);
          const line =
            watch.kind === 'reading'
              ? t(`alarms.template.${watch.edge}`, {
                  value: targetWithUnit(watch.value, watch.metric),
                  length,
                })
              : t('alarms.template.runs', { length });
          const name = templateName(t, template);

          return (
            <li key={template.key}>
              <button
                type="button"
                className={`${ui.card} ${styles.template}`}
                disabled={create.isPending}
                aria-label={t('alarms.template.make', { name, line })}
                onClick={() => make(template)}
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden className={styles.templateIcon} />
                <span className={styles.templateText}>
                  <span className={styles.templateName}>{name}</span>
                  <span className={`mono ${styles.templateLine}`}>
                    {making === template.key ? t('alarms.template.making') : <Facts facts={factsOf(line)} />}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Refused error={create.error} />
    </div>
  );
}

/**
 * That this device is being worked on, and until when: the state that decides
 * what every rule below will do while their switches still stand armed. Both
 * halves are named because they end at different times - the hardware is let
 * go when the window runs out, the alarms are held for the settling after it -
 * and "End now" gives back the hardware at once.
 */
function InMaintenance({ device, me, mayManage, now }: { device: Device; me: Me | undefined; mayManage: boolean; now: DateTime }) {
  const { t } = useTranslation();
  const end = useDeviceCommand();
  // Read against the clock as it is now and not as of the last beat: an End
  // that has just been answered moved the window to this instant, and the beat
  // could be ten seconds behind it - long enough to offer End again.
  const quiet = maintenanceQuiet(device, DateTime.max(now, serverNow()));

  if (!quiet) return null;
  const zone = zoneOf(me);
  const times = { until: clock(quiet.until, zone), alarms: clock(quiet.alarmsUntil, zone) };

  return (
    <div className={`${ui.card} ${styles.maintenance}`} role="status">
      <span className={`mono ${styles.maintenanceText}`}>{t(quiet.parked ? 'maintenance.parked' : 'maintenance.settling', times)}</span>
      {mayManage && quiet.parked ? (
        <button
          type="button"
          className={ui.chip}
          disabled={end.isPending}
          onClick={() => end.mutate({ deviceId: device.id, command: { kind: 'maintenance', forSeconds: 0 } })}
        >
          {t(end.isPending ? 'maintenance.ending' : 'maintenance.end')}
        </button>
      ) : null}
      {mayManage && quiet.parked ? <Help topic="endMaintenance" /> : null}
      <Refused error={end.error} />
    </div>
  );
}

interface RuleCardProps {
  rule: AlarmRule;
  device: Device;
  me: Me | undefined;
  /** Whether the page already says, over the list, that no alarm reaches anybody. */
  toldAbove: boolean;
  mayManage: boolean;
  highlighted: boolean;
  busy: boolean;
  now: DateTime;
  /** Whether another rule of the list carries the same name. */
  twin: boolean;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}

/**
 * One rule: what it watches and the line it trips at, where it came from, and
 * how long, how loud and to whom. The switch is the one thing changed in
 * place; a tap on the card opens the sheet for the rest. A rule that has
 * raised offers an hour of silence, a silenced one to be loud again
 * (`useSilence`).
 *
 * The switch is drawn but not offered where the device does not report what
 * the rule watches - a CO2 rule the stage wrote for a controller with no
 * sensor - and the reason stands under it.
 */
function RuleCard({ rule, device, me, toldAbove, mayManage, highlighted, busy, now, twin, onOpen, onToggle }: RuleCardProps) {
  const { t } = useTranslation();
  const card = useRef<HTMLLIElement>(null);
  const silence = useSilence(rule, device.id, now);

  useEffect(() => {
    if (highlighted) card.current?.scrollIntoView?.({ block: 'center' });
  }, [highlighted]);

  const missing = missingSensor(rule.watch, device);
  const told = willTell(t, rule.severity, rule, me, now);
  // The stage's "too humid" rests while the device germinates, unless the grower asked to be warned there too,
  // and warns at germination's own line where they did - which is the line the card shows while it lasts.
  const workmode = device.configuration?.workmode;
  const resting = rule.enabled && restsInGermination(rule, workmode, device.control?.germinationChoices);
  const watch = watchNow(rule, workmode);
  const ownLine = !resting && boundLabel(t, watch) !== boundLabel(t, rule.watch) ? boundLabel(t, rule.watch) : null;
  // An output watched for running at all crosses no line, so what it watches is
  // said in words and only the duration it has to run for is a figure; a rule
  // that trips on the first sample has not even that.
  const bound =
    watch.kind === 'output_running'
      ? rule.forSeconds > 0
        ? t('alarms.bound.longer', { duration: durationLabel(rule.forSeconds) })
        : ''
      : boundLabel(t, watch);
  const watching = watchLabel(t, rule.watch, device.type);
  const title = ruleTitle(t, rule);

  const summary = (
    <>
      <span className={ui.wrapRow}>
        {rule.state.triggered ? <span className={styles.dot} role="img" aria-label={t('alarms.triggered')} /> : null}
        <span className={styles.name}>{title}</span>
        {watching ? <span className={styles.watching}>{watching}</span> : null}
        {bound ? <span className={`mono ${styles.bound}`}>{bound}</span> : null}
      </span>
      <span className={`mono ${styles.meta}`}>{metaLine(t, rule, told.said)}</span>
      {missing ? <span className={`mono ${styles.reason}`}>{t(`alarms.needs.${missing}`)}</span> : null}
      {resting && !(mayManage && device.spaceId) ? <span className={`mono ${styles.reason}`}>{t('alarms.meta.restsInGermination')}</span> : null}
      {ownLine ? <span className={`mono ${styles.meta}`}>{t('alarms.meta.germinationLine', { bound: ownLine })}</span> : null}
    </>
  );

  return (
    <li ref={card} className={`${ui.card} ${styles.card}`} data-highlight={highlighted || undefined}>
      {mayManage ? (
        <button type="button" className={styles.open} onClick={onOpen}>
          {summary}
        </button>
      ) : (
        <div className={styles.open}>{summary}</div>
      )}
      <span className={styles.side}>
        {/* Whether a rule is watching is worth knowing to anybody who can see
            the tent; the switch that changes it belongs to whoever manages the
            device, so the other reader is given the fact and not the control. */}
        {mayManage ? (
          // Two rules of one name are told apart by their threshold, as the cards are by sight.
          <Switch
            label={t('alarms.enable', { name: twin && bound ? `${title} · ${bound}` : title })}
            on={rule.enabled}
            disabled={missing !== null || busy}
            onChange={onToggle}
          />
        ) : (
          <span className={`mono ${styles.state}`}>{t(rule.enabled ? 'misc.on' : 'misc.off')}</span>
        )}
        {mayManage && (silence.silenced || rule.state.triggered) ? (
          <button type="button" className={ui.chip} disabled={silence.busy} onClick={silence.toggle}>
            {t(silence.silenced ? 'alerts.action.unsilence' : 'alerts.action.silence')}
          </button>
        ) : null}
      </span>
      {silence.error ? (
        <span className={styles.refused}>
          <Refused error={silence.error} />
        </span>
      ) : null}
      {/* Outside the card's button, which a link cannot stand in, and on a line of its own across it.
          Where the choice is made is Steuerung, which shows it while the device germinates. */}
      {resting && mayManage && device.spaceId ? (
        <Link to={controlPath(device.spaceId)} className={`mono ${styles.fix}`}>
          {t('alarms.meta.restsInGerminationChange')}
        </Link>
      ) : null}
      {!toldAbove && rule.enabled && told.unreached ? (
        <Link to="/me/notifications" className={`mono ${styles.fix}`}>
          {t('alarms.meta.reachesNobody')}
        </Link>
      ) : null}
    </li>
  );
}

/**
 * "custom · for 10 min · critical · goes to you by push + Telegram · repeats
 * every 30 min": where the rule came from, how long it has to last, how loud
 * it is, and what it will do to reach the reader (`willTell`). A rule that is
 * off says that instead.
 */
const metaLine = (t: Translate, rule: AlarmRule, told: string[]): string => {
  const parts: string[] = [t(`alarms.origin.${rule.origin}`)];
  if (rule.forSeconds > 0 && rule.watch.kind !== 'output_running') parts.push(t('alarms.meta.for', { length: durationLabel(rule.forSeconds) }));
  parts.push(t(`alarms.severity.${rule.severity}`), ...(rule.enabled ? told : [t('alarms.meta.switchedOff')]));

  return parts.join(' · ');
};
