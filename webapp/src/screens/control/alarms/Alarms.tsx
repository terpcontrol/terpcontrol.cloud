import { DateTime } from 'luxon';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { AlarmRule, Device, NotificationRouting, OverviewGrow } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useDeviceAlarmRules, useUnsilenceAlarmRule, useUpdateAlarmRule } from '@/api/alarm-rules';
import { useSpaceOverview } from '@/api/spaces';
import { durationLabel } from '@/screens/devices/sockets';
import { LoadFailed, RefreshFailed, Refused, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { RuleSheet } from './RuleSheet';
import { boundLabel, groupRules, hasRules, missingSensor, routedChannels } from './rules';
import styles from './Alarms.module.css';

/**
 * The alarm rules of the tent, under Control › Advanced.
 *
 * A rule belongs to the device that measures what it watches, so a tent with
 * two controllers has two lists, each under the name of its device. Within a
 * list the rules stand by where they came from, and the order says what a
 * person can expect of each group: the stage's rules are rewritten at the next
 * stage, the cloud's own are there for every device, the firmware's were asked
 * for by the hardware, and the last group is what was written here.
 *
 * Nothing is decided on this side. Whether a rule stands triggered, whether it
 * is silenced and until when, are the server's answers and are drawn with the
 * server's instants; what this screen adds is what the account's routing would
 * do with the rule, read off the grid the notification settings hold.
 */
export function Alarms({ spaceId, devices, mayManage }: { spaceId: string; devices: Device[]; mayManage: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const overview = useSpaceOverview(spaceId);
  const me = useMe();
  const [params] = useSearchParams();

  const watched = devices.filter(hasRules);
  const grow = overview.data?.grows[0] ?? null;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <span className="label">{[t('alarms.title'), overview.data?.name].filter(Boolean).join(' · ')}</span>
        <Link to={`/spaces/${spaceId}/control`} className={`mono ${styles.back}`}>
          {t('alarms.backToPlan')}
        </Link>
      </header>

      {watched.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('alarms.noController')}</p>
      ) : (
        watched.map(device => (
          <DeviceRules
            key={device.id}
            device={device}
            grow={grow}
            routing={me.data?.notifications.routing}
            mayManage={mayManage}
            highlighted={params.get('rule')}
            named={watched.length > 1}
            now={now}
          />
        ))
      )}

      <p className={ui.note}>{t('alarms.footer')}</p>
    </div>
  );
}

interface DeviceRulesProps {
  device: Device;
  grow: OverviewGrow | null;
  routing: NotificationRouting | undefined;
  mayManage: boolean;
  /** The rule an alert linked to, which is scrolled to and marked. */
  highlighted: string | null;
  /** Whether the device's name is drawn over its list, which it is only where there is another list to tell it from. */
  named: boolean;
  now: DateTime;
}

/** One device's rules, in their groups, with the row that writes a new one under them. */
function DeviceRules({ device, grow, routing, mayManage, highlighted, named, now }: DeviceRulesProps) {
  const { t } = useTranslation();
  const rules = useDeviceAlarmRules(device.id);
  const update = useUpdateAlarmRule(device.id);
  const unsilence = useUnsilenceAlarmRule(device.id);
  const [open, setOpen] = useState<AlarmRule | 'new' | null>(null);

  const name = device.name ?? t(`devices.type.${device.type}`, { defaultValue: device.type });
  const title = named ? <h2 className={styles.deviceName}>{name}</h2> : null;

  if (rules.isPending) {
    return (
      <section className={styles.device}>
        {title}
        <Waiting lines={3} />
      </section>
    );
  }
  if (!rules.data) {
    return (
      <section className={styles.device}>
        {title}
        <LoadFailed retry={() => void rules.refetch()} />
      </section>
    );
  }

  // The name of the stage's group: the preset the grow stands on where the
  // catalogue has a name for it, otherwise the stage itself - and the bare
  // word where nothing grows here yet, because the rules are still the stage's.
  const presetName = grow?.preset ? t(`grow.presetName.${grow.preset}`, { defaultValue: '' }) : '';
  const stageName = presetName || (grow?.stage ? t(`home.stage.${grow.stage}`) : '');
  const groups = groupRules(rules.data.items);

  return (
    <section className={styles.device}>
      {title}
      <RefreshFailed failedAt={rules.isError ? rules.dataUpdatedAt : null} now={now} />

      {groups.map(group => (
        <div key={group.origin} className={styles.group}>
          <header className={styles.groupHead}>
            <span className="label">
              {group.origin === 'preset'
                ? stageName
                  ? t('alarms.group.presetOf', { name: stageName })
                  : t('alarms.group.presetNone')
                : t(`alarms.group.${group.origin}`)}
            </span>
            {group.origin === 'preset' ? <span className={`mono ${styles.groupAside}`}>{t('alarms.group.presetAside')}</span> : null}
          </header>
          <ul className={styles.list}>
            {group.rules.map(rule => (
              <RuleCard
                key={rule.id}
                rule={rule}
                device={device}
                routing={routing}
                mayManage={mayManage}
                highlighted={rule.id === highlighted}
                busy={update.isPending || unsilence.isPending}
                now={now}
                onOpen={() => setOpen(rule)}
                onToggle={enabled => update.mutate({ ruleId: rule.id, body: { enabled } })}
                onUnsilence={() => unsilence.mutate(rule.id)}
              />
            ))}
          </ul>
        </div>
      ))}

      <Refused error={update.error ?? unsilence.error} />

      {mayManage ? (
        <button type="button" className={`${ui.cardDashed} ${styles.add}`} onClick={() => setOpen('new')}>
          {t('alarms.add')}
        </button>
      ) : null}

      {open ? <RuleSheet device={device} rule={open === 'new' ? null : open} routing={routing} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

interface RuleCardProps {
  rule: AlarmRule;
  device: Device;
  routing: NotificationRouting | undefined;
  mayManage: boolean;
  highlighted: boolean;
  busy: boolean;
  now: DateTime;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
  onUnsilence: () => void;
}

/**
 * One rule: what it watches and the line it trips at, where it came from, and
 * how long, how loud and to whom. The switch is the one thing changed in
 * place; everything else is the sheet's, which a tap on the card opens.
 *
 * The switch is drawn but not offered where the device does not report what
 * the rule watches - a CO2 rule the stage wrote for a controller with no
 * sensor - because switching it on would be a promise nothing can keep, and
 * the reason stands under it rather than the control quietly doing nothing.
 */
function RuleCard({ rule, device, routing, mayManage, highlighted, busy, now, onOpen, onToggle, onUnsilence }: RuleCardProps) {
  const { t } = useTranslation();
  const card = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (highlighted) card.current?.scrollIntoView?.({ block: 'center' });
  }, [highlighted]);

  const missing = missingSensor(rule.watch, device);
  const silenced = rule.silencedUntil !== null && DateTime.fromISO(rule.silencedUntil) > now;
  const bound = rule.watch.kind === 'output_running' ? `› ${durationLabel(rule.forSeconds)}` : boundLabel(rule.watch);

  const summary = (
    <>
      <span className={styles.top}>
        {rule.state.triggered ? <span className={styles.dot} role="img" aria-label={t('alarms.triggered')} /> : null}
        <span className={styles.name}>{rule.name}</span>
        {bound ? <span className={`mono ${styles.bound}`}>{bound}</span> : null}
        <span className={`${ui.chip} ${styles.origin}`}>{t(`alarms.origin.${rule.origin}`)}</span>
      </span>
      <span className={`mono ${styles.meta}`}>{metaLine(t, rule, routing)}</span>
      {silenced ? (
        <span className={`mono ${styles.meta}`}>
          {t('alarms.meta.silencedUntil', { time: DateTime.fromISO(rule.silencedUntil!).toLocaleString(DateTime.TIME_SIMPLE) })}
        </span>
      ) : null}
      {missing ? <span className={`mono ${styles.reason}`}>{t(`alarms.needs.${missing}`)}</span> : null}
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
        <button
          type="button"
          className={ui.switch}
          role="switch"
          aria-checked={rule.enabled}
          aria-label={t('alarms.enable', { name: rule.name })}
          disabled={!mayManage || missing !== null || busy}
          onClick={() => onToggle(!rule.enabled)}
        >
          <span className={ui.knob} aria-hidden />
        </button>
        {silenced && mayManage ? (
          <button type="button" className={ui.chip} disabled={busy} onClick={onUnsilence}>
            {t('alarms.unsilence')}
          </button>
        ) : null}
      </span>
    </li>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * "for 10 min · critical · push + Telegram": how long it has to last, how
 * loud it is, and where it goes. A routed rule goes where the account's grid
 * sends that severity, which may be nowhere, and that is said rather than left
 * blank; a rule with a delivery of its own names the channel, and one whose
 * delivery this session was not answered - it is a manager's to see - says
 * only that it has one.
 */
const metaLine = (t: Translate, rule: AlarmRule, routing: NotificationRouting | undefined): string => {
  const parts: string[] = [];
  if (rule.forSeconds > 0 && rule.watch.kind !== 'output_running') parts.push(t('alarms.meta.for', { length: durationLabel(rule.forSeconds) }));
  parts.push(t(`alarms.severity.${rule.severity}`));

  if (rule.delivery.mode === 'routing') {
    const channels = routedChannels(routing, rule.severity);
    parts.push(channels.length > 0 ? channels.map(channel => t(`alarms.channel.${channel}`)).join(' + ') : t('alarms.meta.notAnnounced'));
  } else {
    parts.push(rule.delivery.custom ? t(`alarms.channel.${rule.delivery.custom.channel}`) : t('alarms.meta.ownTarget'));
  }

  if (rule.origin === 'always') parts.push(t('alarms.meta.repeatsUntilBack'));
  else if (rule.repeatSeconds > 0) parts.push(t('alarms.meta.repeatsEvery', { length: durationLabel(rule.repeatSeconds) }));

  return parts.join(' · ');
};
