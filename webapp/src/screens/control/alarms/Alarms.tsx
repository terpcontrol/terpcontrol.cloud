import { DateTime } from 'luxon';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { AlarmRule, Device, Me, OverviewGrow } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useAlarmRulesOf, useDeviceAlarmRules, useUnsilenceAlarmRule, useUpdateAlarmRule } from '@/api/alarm-rules';
import { useSpaceOverview } from '@/api/spaces';
import { durationLabel } from '@/screens/devices/sockets';
import { timeOf } from '@/screens/notifications/settings';
import { LoadFailed, RefreshFailed, Refused, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { clock, zoneOf } from '@/ui/zone';
import { RuleSheet } from './RuleSheet';
import { boundLabel, channelsLabel, groupRules, heldBackBy, missingSensor, routedChannels, ruleTitle, type Translate, watchable } from './rules';
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
 * Which devices get a list is the server's answer and not this screen's guess:
 * the cloud keeps an offline rule for everything that is claimed, and the
 * firmware asks for rules of its own, so a plug, a fan and a lamp all carry
 * rules although none of them measures a climate. A device is therefore listed
 * when it holds a rule or when a rule could be written for it, and the type is
 * asked about once only - for what the sheet has to offer somebody writing one.
 *
 * Nothing is decided on this side. Whether a rule stands triggered, whether it
 * is silenced and until when, are the server's answers and are drawn with the
 * server's instants; what this screen adds is what the account's routing would
 * do with the rule, read off the grid the notification settings hold - and
 * only once they have been read, because a rule is not "not announced" merely
 * because the account has yet to answer for itself.
 */
export function Alarms({ spaceId, devices, mayManage }: { spaceId: string; devices: Device[]; mayManage: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const overview = useSpaceOverview(spaceId);
  const me = useMe();
  const [params] = useSearchParams();

  // The same reads the lists below make, asked once here so that a device
  // nobody could write a rule for is still listed while it holds one.
  const held = useAlarmRulesOf(devices.map(device => device.id));
  const holding = new Set([...held.rules.values()].map(rule => rule.deviceId));
  const watched = devices.filter(device => watchable(device) || holding.has(device.id));
  const grow = overview.data?.grows[0] ?? null;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <span className="label">{[t('alarms.title'), overview.data?.name].filter(Boolean).join(' · ')}</span>
        {watched.length > 0 ? (
          <Link to={`/spaces/${spaceId}/control`} className={`mono ${styles.back}`}>
            {t('alarms.backToPlan')}
          </Link>
        ) : null}
      </header>

      {watched.length === 0 && held.isPending ? (
        <Waiting lines={3} />
      ) : watched.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>
          {t('alarms.noController')}{' '}
          <Link to={`/spaces/${spaceId}/devices`} className={styles.addDevice}>
            {t('alarms.addDevice')}
          </Link>
        </p>
      ) : (
        watched.map(device => (
          <DeviceRules
            key={device.id}
            device={device}
            grow={grow}
            me={me.data}
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
  /** The account, once it has answered; until then nothing is said about where a routed rule goes. */
  me: Me | undefined;
  mayManage: boolean;
  /** The rule an alert linked to, which is scrolled to and marked. */
  highlighted: string | null;
  /** Whether the device's name is drawn over its list, which it is only where there is another list to tell it from. */
  named: boolean;
  now: DateTime;
}

/** One device's rules, in their groups, with the row that writes a new one under them. */
function DeviceRules({ device, grow, me, mayManage, highlighted, named, now }: DeviceRulesProps) {
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
                me={me}
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

      {mayManage && watchable(device) ? (
        <button type="button" className={`${ui.cardDashed} ${styles.add}`} onClick={() => setOpen('new')}>
          {t('alarms.add')}
        </button>
      ) : null}

      {open ? <RuleSheet device={device} rule={open === 'new' ? null : open} me={me} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

interface RuleCardProps {
  rule: AlarmRule;
  device: Device;
  me: Me | undefined;
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
function RuleCard({ rule, device, me, mayManage, highlighted, busy, now, onOpen, onToggle, onUnsilence }: RuleCardProps) {
  const { t } = useTranslation();
  const card = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (highlighted) card.current?.scrollIntoView?.({ block: 'center' });
  }, [highlighted]);

  const missing = missingSensor(rule.watch, device);
  const silenced = rule.silencedUntil !== null && DateTime.fromISO(rule.silencedUntil) > now;
  // An output watched for running at all has no band, and a rule that trips on
  // the first sample has no duration either, so there is nothing to draw beside
  // its name rather than a line at nothing.
  const bound = rule.watch.kind === 'output_running' ? (rule.forSeconds > 0 ? `› ${durationLabel(rule.forSeconds)}` : '') : boundLabel(rule.watch);
  const title = ruleTitle(t, rule, device);

  const summary = (
    <>
      <span className={styles.top}>
        {rule.state.triggered ? <span className={styles.dot} role="img" aria-label={t('alarms.triggered')} /> : null}
        <span className={styles.name}>{title}</span>
        {bound ? <span className={`mono ${styles.bound}`}>{bound}</span> : null}
      </span>
      <span className={`mono ${styles.meta}`}>{metaLine(t, rule, me, now)}</span>
      {silenced ? (
        <span className={`mono ${styles.meta}`}>{t('alarms.meta.silencedUntil', { time: clock(rule.silencedUntil!, zoneOf(me)) })}</span>
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
        {/* Whether a rule is watching is worth knowing to anybody who can see
            the tent; the switch that changes it belongs to whoever manages the
            device, so the other reader is given the fact and not the control. */}
        {mayManage ? (
          <button
            type="button"
            className={ui.switch}
            role="switch"
            aria-checked={rule.enabled}
            aria-label={t('alarms.enable', { name: title })}
            disabled={missing !== null || busy}
            onClick={() => onToggle(!rule.enabled)}
          >
            <span className={ui.knob} aria-hidden />
          </button>
        ) : (
          <span className={`mono ${styles.state}`}>{t(rule.enabled ? 'misc.on' : 'misc.off')}</span>
        )}
        {silenced && mayManage ? (
          <button type="button" className={ui.chip} disabled={busy} onClick={onUnsilence}>
            {t('alarms.unsilence')}
          </button>
        ) : null}
      </span>
    </li>
  );
}

/**
 * "custom · for 10 min · critical · goes to you by push + Telegram · repeats
 * every 30 min": where the rule came from, how long it has to last, how loud
 * it is, where it goes and how often it says so again. The origin rides here
 * rather than beside the name because a long name leaves it alone on a line of
 * its own.
 *
 * A routed rule goes where the account's grid sends that severity, which may
 * be nowhere, and that is said rather than left blank - but only once the
 * account has answered, since until then nothing is known either way. It is
 * said as the reader's own, because that is what it is: a tent with two
 * managers has one rule and two routings, and naming the channels flatly would
 * tell each of them that the rule itself is what the other one's settings say.
 * A rule with a delivery of its own names the channel, and one whose delivery
 * this session was not answered - it is a manager's to see - says only that it
 * has one. What repeats is what the rule itself carries, whoever wrote it: the
 * engine says an alarm again on `repeatSeconds` and never on anything else, so
 * the rule the cloud keeps is described by its own half hour like the rest.
 * How often something is said is left off where it is not said at all.
 *
 * Everything about being told is in the future tense, and a rule that is off
 * has no future to speak of: it is watching nothing, so it will reach nobody
 * and repeat nothing whatever it is set to. The line therefore ends at the
 * state rather than going on to promise a delivery and a half hour that only
 * hold once somebody throws the switch beside it. What the rule is set to do
 * is not lost with it - it is all in the sheet the card opens.
 *
 * An account that has muted itself, or that is inside its own quiet hours, is
 * the same case: the server sends nothing at all while either holds, so a
 * routed rule ends at the silence rather than going on to name channels and a
 * half hour that nothing would come out of. Which silence it is, is said, and
 * until when - the inbox says it in those words two taps away, and the way out
 * is there rather than here. A rule delivering to a target of its own is not
 * qualified: it goes out through the alarm's own delivery and really does
 * still send while the account is quiet, so saying otherwise would be the same
 * lie told the other way round.
 */
const metaLine = (t: Translate, rule: AlarmRule, me: Me | undefined, now: DateTime): string => {
  const parts: string[] = [t(`alarms.origin.${rule.origin}`)];
  if (rule.forSeconds > 0 && rule.watch.kind !== 'output_running') parts.push(t('alarms.meta.for', { length: durationLabel(rule.forSeconds) }));
  parts.push(t(`alarms.severity.${rule.severity}`));

  const routed = rule.delivery.mode === 'routing' ? routedChannels(me, rule.severity) : null;
  const held = routed === null ? null : heldBackBy(me, rule.severity, now);
  const announced = routed === null || me === undefined || routed.length > 0;

  if (routed === null) parts.push(rule.delivery.custom ? t(`alarms.channel.${rule.delivery.custom.channel}`) : t('alarms.meta.ownTarget'));
  else if (me && rule.enabled && held === 'muted') parts.push(t('alarms.meta.mutedUntil', { time: clock(me.notifications.mutedUntil!, zoneOf(me)) }));
  else if (me && rule.enabled && held === 'quiet') parts.push(t('alarms.meta.quietUntil', { time: timeOf(me.notifications.quietHours!.toMinute) }));
  else if (me && rule.enabled) parts.push(announced ? t('alarms.meta.toYou', { channels: channelsLabel(t, routed) }) : t('alarms.meta.notAnnounced'));

  if (!rule.enabled) parts.push(t('alarms.meta.switchedOff'));
  else if (announced && held === null) {
    parts.push(
      rule.repeatSeconds > 0 ? t('alarms.meta.repeatsEvery', { length: durationLabel(rule.repeatSeconds) }) : t('alarms.meta.announcedOnce'),
    );
  }

  return parts.join(' · ');
};
