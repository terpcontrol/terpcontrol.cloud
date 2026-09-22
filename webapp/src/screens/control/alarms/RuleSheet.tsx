import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AlarmRule, Device, Metric, NotificationRouting, OutputMetric, Severity, WebhookMethod } from '@fg2/shared-types/v1';
import { useCreateAlarmRule, useRemoveAlarmRule, useUpdateAlarmRule } from '@/api/alarm-rules';
import { Sheet } from '@/log/Sheet';
import { Refused } from '@/ui/PageState';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import {
  createBody,
  draftOf,
  emptyDraft,
  hasBound,
  OUTPUTS,
  readingsOf,
  routedChannels,
  type RuleDraft,
  unitOf,
  updateBody,
  watchOf,
  wantsBound,
} from './rules';
import styles from './Alarms.module.css';

const SEVERITIES: Severity[] = ['critical', 'warning', 'info'];
const METHODS: WebhookMethod[] = ['GET', 'POST', 'PUT'];

/**
 * Writing a rule, and changing one.
 *
 * The same sheet for both, filled in from the rule where there is one, because
 * a rule is the same handful of questions whichever way round: what to watch,
 * where the line is, how long past it counts, how loud, and who hears. A rule
 * the stage wrote can be changed here too, and the sheet says what that is
 * worth - the next stage writes its thresholds again.
 *
 * What the sheet refuses itself is one thing only: a band with no edge, which
 * is a rule that could never trip. Everything else is the server's to refuse,
 * and its answer stays in the sheet under the button that asked.
 */
export function RuleSheet({
  device,
  rule,
  routing,
  onClose,
}: {
  device: Device;
  rule: AlarmRule | null;
  routing: NotificationRouting | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateAlarmRule(device.id);
  const update = useUpdateAlarmRule(device.id);
  const remove = useRemoveAlarmRule(device.id);
  const readings = readingsOf(device);
  const [draft, setDraft] = useState<RuleDraft>(() => (rule ? draftOf(rule) : emptyDraft(readings[0])));
  const [askingDelete, setAskingDelete] = useState(false);
  const [refusedBound, setRefusedBound] = useState(false);

  const change = (over: Partial<RuleDraft>) => setDraft(current => ({ ...current, ...over }));
  const busy = create.isPending || update.isPending || remove.isPending;
  const unit = unitOf(watchOf(draft));
  const channels = routedChannels(routing, draft.severity);

  // A reading the device does not report is still drawn where the rule already
  // watches it - the offline rule, a CO2 rule on a controller with no sensor -
  // so the sheet says what the rule is rather than pretending it is something else.
  const current = draft.watch.kind === 'reading' ? draft.watch.metric : null;
  const offered: Metric[] = current && !readings.includes(current) ? [...readings, current] : readings;

  const save = () => {
    if (!hasBound(draft)) {
      setRefusedBound(true);
      return;
    }
    setRefusedBound(false);
    if (rule) update.mutate({ ruleId: rule.id, body: updateBody(draft) }, { onSuccess: onClose });
    else create.mutate(createBody(draft), { onSuccess: onClose });
  };

  return (
    <Sheet title={t(rule ? 'alarms.sheet.title' : 'alarms.sheet.newTitle')} onClose={onClose}>
      <div className={styles.sheet}>
        <Block label={t('alarms.sheet.name')}>
          <input
            className={ui.input}
            value={draft.name}
            placeholder={t('alarms.sheet.nameHint')}
            aria-label={t('alarms.sheet.name')}
            autoComplete="off"
            onChange={event => change({ name: event.target.value })}
          />
          {rule?.origin === 'preset' ? <p className={ui.note}>{t('alarms.sheet.presetNote')}</p> : null}
        </Block>

        <Block label={t('alarms.sheet.watch')}>
          <Choices label={t('alarms.sheet.watch')}>
            {offered.map(metric => (
              <Choice
                key={metric}
                chosen={draft.watch.kind === 'reading' && draft.watch.metric === metric}
                onChoose={() => change({ watch: { kind: 'reading', metric } })}
              >
                {metricName(t, metric)}
              </Choice>
            ))}
            {OUTPUTS.map(output => (
              <Choice
                key={output}
                chosen={draft.watch.kind !== 'reading' && draft.watch.output === output}
                onChoose={() => change({ watch: { kind: draft.watch.kind === 'reading' ? 'output_level' : draft.watch.kind, output } })}
              >
                {t(`alarms.output.${output}`)}
              </Choice>
            ))}
          </Choices>

          {draft.watch.kind !== 'reading' ? <OutputHow watch={draft.watch} onChange={watch => change({ watch })} /> : null}
        </Block>

        {wantsBound(draft) ? (
          <Block label={t('alarms.sheet.bounds')}>
            <div className={styles.bounds}>
              <BoundField label={t('alarms.sheet.above')} unit={unit} value={draft.upper} onChange={upper => change({ upper })} />
              <BoundField label={t('alarms.sheet.below')} unit={unit} value={draft.lower} onChange={lower => change({ lower })} />
            </div>
            {draft.watch.kind === 'output_level' && draft.watch.output !== 'light' ? (
              <p className={ui.note}>{t('alarms.sheet.fractionNote')}</p>
            ) : null}
            {refusedBound && !hasBound(draft) ? (
              <p className={ui.problem} role="alert">
                {t('alarms.sheet.noBound')}
              </p>
            ) : null}
          </Block>
        ) : null}

        <Block label={t('alarms.sheet.for')}>
          <Minutes label={t('alarms.sheet.for')} value={draft.forMinutes} onChange={forMinutes => change({ forMinutes })} />
          <p className={ui.note}>{t(draft.watch.kind === 'output_running' ? 'alarms.sheet.forRunningNote' : 'alarms.sheet.forNote')}</p>
        </Block>

        <Block label={t('alarms.sheet.severity')}>
          <Choices label={t('alarms.sheet.severity')}>
            {SEVERITIES.map(severity => (
              <Choice key={severity} chosen={draft.severity === severity} onChoose={() => change({ severity })}>
                {t(`alarms.severity.${severity}`)}
              </Choice>
            ))}
          </Choices>
        </Block>

        <Block label={t('alarms.sheet.tellBy')}>
          <Choices label={t('alarms.sheet.tellBy')}>
            {(['routing', 'email', 'webhook'] as const).map(tellBy => (
              <Choice key={tellBy} chosen={draft.tellBy === tellBy} onChoose={() => change({ tellBy })}>
                {t(`alarms.sheet.by.${tellBy}`)}
              </Choice>
            ))}
          </Choices>

          {draft.tellBy === 'routing' ? (
            <p className={ui.note}>
              {draft.severity === 'info'
                ? t('alarms.sheet.infoNote')
                : channels.length > 0
                  ? t('alarms.sheet.routingNote', { channels: channels.map(channel => t(`alarms.channel.${channel}`)).join(' + ') })
                  : t('alarms.sheet.routingNone', { severity: t(`alarms.severity.${draft.severity}`) })}
            </p>
          ) : null}

          {draft.tellBy === 'email' ? (
            <input
              className={ui.input}
              type="email"
              value={draft.email}
              aria-label={t('alarms.sheet.address')}
              placeholder={t('alarms.sheet.address')}
              autoComplete="off"
              onChange={event => change({ email: event.target.value })}
            />
          ) : null}

          {draft.tellBy === 'webhook' ? <WebhookFields draft={draft} onChange={change} /> : null}
        </Block>

        <Block label={t('alarms.sheet.repeat')}>
          <Minutes label={t('alarms.sheet.repeatEvery')} value={draft.repeatMinutes} onChange={repeatMinutes => change({ repeatMinutes })} />
          <p className={ui.note}>{t('alarms.sheet.repeatNote')}</p>
        </Block>

        <Refused error={create.error ?? update.error ?? remove.error} />

        <button type="button" className={`${ui.button} ${ui.primary} ${styles.submit}`} disabled={busy} onClick={save}>
          {busy ? t('grow.lifecycle.saving') : t('alarms.sheet.save')}
        </button>

        {rule && rule.origin !== 'always' ? (
          askingDelete ? (
            <div className={styles.asking}>
              <p className={ui.note}>{t('alarms.sheet.deleteAsk')}</p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${ui.button} ${styles.dangerButton}`}
                  disabled={busy}
                  onClick={() => remove.mutate(rule.id, { onSuccess: onClose })}
                >
                  {t('alarms.sheet.deleteYes')}
                </button>
                <button type="button" className={ui.button} onClick={() => setAskingDelete(false)}>
                  {t('grow.lifecycle.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={`${ui.button} ${styles.danger}`} disabled={busy} onClick={() => setAskingDelete(true)}>
              {t('alarms.sheet.delete')}
            </button>
          )
        ) : null}
      </div>
    </Sheet>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** What a reading is called: the card's own word where the home has one, the alarm screen's for the sensors the home does not draw. */
const metricName = (t: Translate, metric: Metric): string =>
  t(`home.metric.${metric}`, { defaultValue: t(`alarms.metric.${metric}`, { defaultValue: metric }) });

/** Whether an output is watched for how hard it runs or for running at all. */
function OutputHow({
  watch,
  onChange,
}: {
  watch: { kind: 'output_level' | 'output_running'; output: OutputMetric };
  onChange: (watch: { kind: 'output_level' | 'output_running'; output: OutputMetric }) => void;
}) {
  const { t } = useTranslation();

  return (
    <Choices label={t('alarms.sheet.how')}>
      <Choice chosen={watch.kind === 'output_level'} onChoose={() => onChange({ kind: 'output_level', output: watch.output })}>
        {t('alarms.sheet.level')}
      </Choice>
      <Choice chosen={watch.kind === 'output_running'} onChoose={() => onChange({ kind: 'output_running', output: watch.output })}>
        {t('alarms.sheet.running')}
      </Choice>
    </Choices>
  );
}

/** One edge of the band. Empty is no edge on that side, which is not zero. */
function BoundField({ label, unit, value, onChange }: { label: string; unit: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className={styles.figure}>
      <span className={styles.figureLabel}>{label}</span>
      <input
        className={`mono ${styles.figureInput}`}
        type="number"
        inputMode="decimal"
        step="any"
        placeholder="—"
        aria-label={label}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
      {unit ? <span className={`mono ${styles.figureUnit}`}>{unit}</span> : null}
    </label>
  );
}

/** A length in minutes. Not whole ones only: a rule the firmware asked for may hold ninety seconds, and saving it must not round that away. */
function Minutes({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const { t } = useTranslation();

  return (
    <div className={styles.duration}>
      <input
        className={`${ui.input} ${styles.number}`}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={value}
        aria-label={label}
        onChange={event => onChange(Math.max(0, Number(event.target.value) || 0))}
      />
      <span className={`mono ${styles.figureUnit}`}>{t('alarms.sheet.minutes')}</span>
    </div>
  );
}

/** Where a webhook goes and how it is called: the URL, the method, the headers, the two bodies and the two switches. */
function WebhookFields({ draft, onChange }: { draft: RuleDraft; onChange: (over: Partial<RuleDraft>) => void }) {
  const { t } = useTranslation();

  return (
    <div className={styles.fields}>
      <input
        className={ui.input}
        type="url"
        value={draft.url}
        aria-label={t('alarms.sheet.url')}
        placeholder={t('alarms.sheet.url')}
        autoComplete="off"
        onChange={event => onChange({ url: event.target.value })}
      />
      <Choices label={t('alarms.sheet.method')}>
        {METHODS.map(method => (
          <Choice key={method} chosen={draft.method === method} onChoose={() => onChange({ method })}>
            {method}
          </Choice>
        ))}
      </Choices>
      <label className="label" htmlFor="rule-headers">
        {t('alarms.sheet.headers')}
      </label>
      <textarea
        id="rule-headers"
        className={`mono ${ui.input} ${styles.textarea}`}
        rows={3}
        value={draft.headers}
        placeholder={t('alarms.sheet.headersHint')}
        onChange={event => onChange({ headers: event.target.value })}
      />
      <label className="label" htmlFor="rule-triggered">
        {t('alarms.sheet.triggeredPayload')}
      </label>
      <textarea
        id="rule-triggered"
        className={`mono ${ui.input} ${styles.textarea}`}
        rows={3}
        value={draft.triggeredPayload}
        placeholder={t('alarms.sheet.payloadHint')}
        onChange={event => onChange({ triggeredPayload: event.target.value })}
      />
      <label className="label" htmlFor="rule-resolved">
        {t('alarms.sheet.resolvedPayload')}
      </label>
      <textarea
        id="rule-resolved"
        className={`mono ${ui.input} ${styles.textarea}`}
        rows={3}
        value={draft.resolvedPayload}
        placeholder={t('alarms.sheet.payloadHint')}
        onChange={event => onChange({ resolvedPayload: event.target.value })}
      />
      <Toggle label={t('alarms.sheet.reportErrors')} on={draft.reportErrors} onToggle={reportErrors => onChange({ reportErrors })} />
      <Toggle label={t('alarms.sheet.tunnel')} note={t('alarms.sheet.tunnelNote')} on={draft.tunnel} onToggle={tunnel => onChange({ tunnel })} />
    </div>
  );
}

/** A switch with what it means beside it: the app's own control, in the row the plan editor draws it in. */
function Toggle({ label, note, on, onToggle }: { label: string; note?: string; on: boolean; onToggle: (on: boolean) => void }) {
  return (
    <div className={styles.toggle}>
      <span className={styles.toggleText}>
        <span className={styles.toggleLabel}>{label}</span>
        {note ? <span className={ui.note}>{note}</span> : null}
      </span>
      <button type="button" className={ui.switch} role="switch" aria-checked={on} aria-label={label} onClick={() => onToggle(!on)}>
        <span className={ui.knob} aria-hidden />
      </button>
    </div>
  );
}
