import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { AlarmRule, Device, Me, Metric, OutputMetric, Severity } from '@fg2/shared-types/v1';
import { useCreateAlarmRule, useRemoveAlarmRule, useUpdateAlarmRule } from '@/api/alarm-rules';
import type { Translate } from '@/i18n/i18n';
import { Sheet } from '@/ui/Sheet';
import { EmailAlarmsOffer } from '@/screens/notifications/NotifyNotice';
import { channelsLabel, routedChannels } from '@/screens/notifications/reach';
import { WEBHOOK_METHODS } from '@/screens/notifications/settings';
import { Refused } from '@/ui/PageState';
import advanced from '@/ui/advanced/Advanced.module.css';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import { SwitchRow } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
import {
  createBody,
  DEFAULT_WATCH,
  draftOf,
  emptyDraft,
  firstWatch,
  hasBound,
  outputName,
  outputsOf,
  readingsOf,
  type RuleDraft,
  ruleTitle,
  scaleNote,
  unitOf,
  updateBody,
  watchesOffline,
  watchOf,
  wantsBound,
  withSeverity,
} from './rules';
import { isComplete, templateOf, WEBHOOK_TEMPLATES, type TemplateValues, type WebhookTemplate } from './webhook-templates';
import styles from './Alarms.module.css';

const SEVERITIES: Severity[] = ['critical', 'warning', 'info'];

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
 *
 * The rule the cloud keeps for every device is the one this sheet does not ask
 * its usual questions of: what it watches is the health loop rather than a
 * series, so it has neither a line to cross nor anything else it could be
 * pointed at, and the sheet says so instead of demanding a bound it would then
 * refuse to save.
 */
export function RuleSheet({ device, rule, me, onClose }: { device: Device; rule: AlarmRule | null; me: Me | undefined; onClose: () => void }) {
  const { t } = useTranslation();
  const create = useCreateAlarmRule(device.id);
  const update = useUpdateAlarmRule(device.id);
  const remove = useRemoveAlarmRule(device.id);
  const readings = readingsOf(device);
  // A rule a stage wrote carries the server's English name; the field opens on
  // the name the list shows it by, so "Zu warm" is not edited as "Too hot".
  const [draft, setDraft] = useState<RuleDraft>(() =>
    rule ? { ...draftOf(rule), name: rule.origin === 'preset' ? ruleTitle(t, rule) : rule.name } : emptyDraft(firstWatch(device) ?? DEFAULT_WATCH),
  );
  const [askingDelete, setAskingDelete] = useState(false);
  const [refusedBound, setRefusedBound] = useState(false);

  const change = (over: Partial<RuleDraft>) => setDraft(current => ({ ...current, ...over }));
  const busy = create.isPending || update.isPending || remove.isPending;
  const unit = unitOf(watchOf(draft));
  const offline = watchesOffline(draft.watch);
  const deliveryNote = draft.tellBy === 'routing' ? routingNote(t, draft, me) : null;
  // A rule the account's grid sends nowhere it can be reached gets the fix
  // beside the sentence that says so: for a critical one the same tap the
  // notice on Start offers, which leaves this sheet and its draft where they
  // are; for a warning, the way to the settings that route it.
  const reachedBy = me && draft.tellBy === 'routing' && draft.severity !== 'info' ? routedChannels(me, draft.severity) : null;
  const unreached = reachedBy !== null && !reachedBy.some(routed => routed.configured);

  // A reading or an output the device does not report is still drawn where the
  // rule already watches it - a CO2 rule on a controller with no sensor, a
  // fridge rule on hardware that was swapped - so the sheet says what the rule
  // is rather than pretending it is something else.
  const current = draft.watch.kind === 'reading' ? draft.watch.metric : null;
  const offered: Metric[] = current && !readings.includes(current) ? [...readings, current] : readings;
  const watchedOutput = draft.watch.kind === 'reading' ? null : draft.watch.output;
  const outputs = outputsOf(device);
  const outputChips: OutputMetric[] = watchedOutput && !outputs.includes(watchedOutput) ? [...outputs, watchedOutput] : outputs;

  const save = () => {
    if (!hasBound(draft)) {
      setRefusedBound(true);
      return;
    }
    setRefusedBound(false);
    if (rule) update.mutate({ ruleId: rule.id, body: updateBody(draft) }, { onSuccess: onClose });
    else create.mutate(createBody(draft), { onSuccess: onClose });
  };

  const actions = (
    <>
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
                className={`${ui.button} ${ui.dangerFilled}`}
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
          <button type="button" className={`${ui.button} ${ui.danger}`} disabled={busy} onClick={() => setAskingDelete(true)}>
            {t('alarms.sheet.delete')}
          </button>
        )
      ) : null}
    </>
  );

  return (
    <Sheet title={t(rule ? 'alarms.sheet.title' : 'alarms.sheet.newTitle')} actions={actions} onClose={onClose}>
      <div className={styles.sheet}>
        {/* The cloud's own offline rule is titled from the kind of hardware it
            watches, in the language the page is being read in, and never from
            the name it carries: a name typed here would reach only the push the
            server titles with it, which every screen then contradicts. The field
            goes, the way the watch and the bounds already do for this rule. */}
        {rule?.origin === 'always' ? null : (
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
        )}

        <Block label={t('alarms.sheet.watch')}>
          {offline ? (
            <p className={ui.note}>{t('alarms.sheet.offlineWatch')}</p>
          ) : (
            <>
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
                {outputChips.map(output => (
                  <Choice
                    key={output}
                    chosen={draft.watch.kind !== 'reading' && draft.watch.output === output}
                    onChoose={() => change({ watch: { kind: draft.watch.kind === 'reading' ? 'output_level' : draft.watch.kind, output } })}
                  >
                    {outputName(t, output, device.type)}
                  </Choice>
                ))}
              </Choices>

              {draft.watch.kind !== 'reading' ? <OutputHow watch={draft.watch} onChange={watch => change({ watch })} /> : null}
            </>
          )}
        </Block>

        {wantsBound(draft) ? (
          <Block label={t('alarms.sheet.bounds')}>
            <div className={styles.bounds}>
              <BoundField label={t('alarms.sheet.above')} unit={unit} value={draft.upper} onChange={upper => change({ upper })} />
              <BoundField label={t('alarms.sheet.below')} unit={unit} value={draft.lower} onChange={lower => change({ lower })} />
            </div>
            {/* What the figure above means, for the outputs whose series has no
                unit to say it. A percentage says it with the sign on the field
                itself, and is the one that needs no sentence. */}
            {draft.watch.kind === 'output_level' && scaleNote(draft.watch.output) ? (
              <p className={ui.note}>{t(scaleNote(draft.watch.output)!)}</p>
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
          <p className={ui.note}>{t(forNote(draft))}</p>
        </Block>

        <Block label={t('alarms.sheet.severity')} help="severity">
          <Choices label={t('alarms.sheet.severity')}>
            {SEVERITIES.map(severity => (
              <Choice key={severity} chosen={draft.severity === severity} onChoose={() => setDraft(current => withSeverity(current, severity))}>
                {t(`alarms.severity.${severity}`)}
              </Choice>
            ))}
          </Choices>
        </Block>

        <Block label={t('alarms.sheet.tellBy')} help="tellBy">
          <Choices label={t('alarms.sheet.tellBy')}>
            {(['routing', 'email', 'webhook'] as const).map(tellBy => (
              <Choice key={tellBy} chosen={draft.tellBy === tellBy} onChoose={() => change({ tellBy })}>
                {t(`alarms.sheet.by.${tellBy}`)}
              </Choice>
            ))}
          </Choices>

          {deliveryNote ? <p className={ui.note}>{deliveryNote}</p> : null}
          {unreached && me ? (
            draft.severity === 'critical' ? (
              <EmailAlarmsOffer me={me} others={false} />
            ) : (
              <Link to="/me/notifications" className={`mono ${ui.headLink}`}>
                {t('alarms.sheet.setUp')} ›
              </Link>
            )
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

        {draft.severity === 'critical' ? <Repeat draft={draft} onChange={change} /> : null}

        <RuleAdvanced draft={draft} onChange={change} />
      </div>
    </Sheet>
  );
}

/** How often the rule says itself again while it lasts. */
function Repeat({ draft, onChange, help }: { draft: RuleDraft; onChange: (over: Partial<RuleDraft>) => void; help?: 'alarmRepeat' }) {
  const { t } = useTranslation();

  return (
    <Block label={t('alarms.sheet.repeat')} help={help}>
      <Minutes label={t('alarms.sheet.repeatEvery')} value={draft.repeatMinutes} onChange={repeatMinutes => onChange({ repeatMinutes })} />
      <p className={ui.note}>{t(draft.tellBy === 'email' ? 'alarms.sheet.repeatNoteEmail' : 'alarms.sheet.repeatNote')}</p>
    </Block>
  );
}

/**
 * What few rules need, folded at the foot of the sheet: a template that fills
 * in a webhook for a known service, and the repeat of a rule that is not
 * critical - which a critical rule asks in the open, and which a webhook
 * switching something at home wants at any level, in case one call was lost.
 * A quieter rule that already repeats opens the section, so its interval is
 * never hidden behind a fold.
 */
function RuleAdvanced({ draft, onChange }: { draft: RuleDraft; onChange: (over: Partial<RuleDraft>) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(draft.severity !== 'critical' && draft.repeatMinutes > 0);
  const webhook = draft.tellBy === 'webhook';
  const quiet = draft.severity !== 'critical';
  if (!webhook && !quiet) return null;

  return (
    <details className={advanced.section} open={open}>
      <summary
        className="label"
        onClick={event => {
          event.preventDefault();
          setOpen(!open);
        }}
      >
        {t('advanced.title')}
      </summary>
      {open ? (
        <div className={styles.sheet}>
          {webhook ? <TemplateFields draft={draft} onChange={onChange} /> : null}
          {quiet ? <Repeat draft={draft} onChange={onChange} help="alarmRepeat" /> : null}
        </div>
      ) : null}
    </details>
  );
}

/**
 * A webhook for Home Assistant, Discord, Telegram or ntfy, from the few
 * answers each of them asks for. It fills in the webhook fields above and
 * saves nothing itself; a rule that matches a template opens it with its
 * answers read back out of the URL and the message.
 */
function TemplateFields({ draft, onChange }: { draft: RuleDraft; onChange: (over: Partial<RuleDraft>) => void }) {
  const { t } = useTranslation();
  const matched = templateOf(draft);
  const [chosen, setChosen] = useState<WebhookTemplate | null>(matched);
  const [values, setValues] = useState<TemplateValues>(() => (matched?.read(draft) ?? {}) as TemplateValues);
  const [filled, setFilled] = useState(false);

  const choose = (template: WebhookTemplate) => {
    setChosen(template);
    setFilled(false);
    setValues(
      Object.fromEntries(
        template.fields.map(field => [field.key, template === matched ? (matched.read(draft)?.[field.key] ?? '') : (field.initial ?? '')]),
      ),
    );
  };

  return (
    <Block label={t('alarms.sheet.template')} help="webhookTemplate">
      <Choices label={t('alarms.sheet.template')}>
        {WEBHOOK_TEMPLATES.map(template => (
          <Choice key={template.id} chosen={chosen?.id === template.id} onChoose={() => choose(template)}>
            {t(`webhookTargets.${template.id}.name`)}
          </Choice>
        ))}
      </Choices>
      {chosen ? (
        <div className={styles.fields}>
          <p className={ui.note}>{t(`webhookTargets.${chosen.id}.hint`)}</p>
          {chosen.fields.map(field => (
            <label key={field.key} className={styles.templateField}>
              <span className="label">{t(field.label)}</span>
              <input
                className={ui.input}
                type={field.secret ? 'password' : 'text'}
                value={values[field.key] ?? ''}
                placeholder={field.placeholder}
                autoComplete="off"
                spellCheck={false}
                onChange={event => {
                  setFilled(false);
                  setValues(current => ({ ...current, [field.key]: event.target.value }));
                }}
              />
            </label>
          ))}
          <button
            type="button"
            className={ui.button}
            disabled={!isComplete(chosen, values)}
            onClick={() => {
              onChange(chosen.fill(values, t));
              setFilled(true);
            }}
          >
            {t('alarms.sheet.templateFill')}
          </button>
          {filled ? (
            <p className={ui.note} role="status">
              {t(draft.tunnel ? 'alarms.sheet.templateFilledTunnel' : 'alarms.sheet.templateFilled')}
            </p>
          ) : null}
        </div>
      ) : null}
    </Block>
  );
}

/** What "for how long" means, which differs for an output that is only ever on, and for the ten minutes the health loop already waits. */
const forNote = (draft: RuleDraft): string => {
  if (watchesOffline(draft.watch)) return 'alarms.sheet.forOfflineNote';

  return draft.watch.kind === 'output_running' ? 'alarms.sheet.forRunningNote' : 'alarms.sheet.forNote';
};

/**
 * Where a rule delivered by the account's settings would actually go. Nothing
 * is claimed before the account has answered - in the demo it never does - and
 * a channel the account has not set up is named as the dead end it is rather
 * than counted as a way of hearing about this.
 */
const routingNote = (t: Translate, draft: RuleDraft, me: Me | undefined): string | null => {
  if (draft.severity === 'info') return t('alarms.sheet.infoNote');
  if (!me) return null;
  const channels = routedChannels(me, draft.severity);

  return channels.length > 0
    ? t('alarms.sheet.routingNote', { channels: channelsLabel(t, channels) })
    : t('alarms.sheet.routingNone', { severity: t(`alarms.severity.${draft.severity}`) });
};

/**
 * What a reading is called, written out: the home card abbreviates to fit four
 * figures across, and a chip somebody is choosing what to watch from has room
 * for the whole word.
 */
const metricName = (t: Translate, metric: Metric): string =>
  t(`alarms.metric.${metric}`, { defaultValue: t(`home.metric.${metric}`, { defaultValue: metric }) });

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
        {WEBHOOK_METHODS.map(method => (
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
      <SwitchRow label={t('alarms.sheet.reportErrors')} on={draft.reportErrors} onChange={reportErrors => onChange({ reportErrors })} />
      <SwitchRow label={t('alarms.sheet.tunnel')} note={t('alarms.sheet.tunnelNote')} on={draft.tunnel} onChange={tunnel => onChange({ tunnel })} />
    </div>
  );
}
