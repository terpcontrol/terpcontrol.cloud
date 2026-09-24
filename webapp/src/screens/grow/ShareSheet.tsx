import { DateTime } from 'luxon';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, ShareLink, TimeRange } from '@fg2/shared-types/v1';
import { useUpdateGrow } from '@/api/grows';
import { useCreateShareLink, useDeleteShareLink, useRevokeShareLink, useShareLinks, useUpdateShareLink } from '@/api/sharing';
import { Sheet } from '@/log/Sheet';
import { ageLabel } from '@/ui/age';
import { appUrl } from '@/ui/clipboard';
import { CopyButton } from '@/ui/CopyButton';
import type { HelpTopic } from '@/ui/explain';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { useNow } from '@/ui/useNow';
import ui from '@/ui/ui.module.css';
import { calendarDay, useZone, zoned } from '@/ui/zone';
import styles from './ShareSheet.module.css';

/**
 * Letting somebody else read this diary, in the two ways there are.
 *
 * A **public page** is the diary at an address of its own, readable by anybody
 * who has it and by a search engine - one switch, and the address never moves,
 * because the slug is fixed when the grow is created and turning the page off
 * and on again brings back the same one.
 *
 * A **link** is a key handed to one person: a window of days, with or without
 * the camera's pictures, and an end date if it should have one. It can be
 * narrowed after it has left the house but never repointed, and ending it is
 * not deleting it - a link that was sent out and is regretted is revoked, and
 * stays listed with the instant it stopped working on it.
 */
export function ShareSheet({ grow, onClose }: { grow: GrowListItem; onClose: () => void }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const links = useShareLinks();
  const update = useUpdateGrow(grow.id);
  const create = useCreateShareLink();
  const [drafting, setDrafting] = useState(false);

  const isPublic = grow.visibility === 'public';
  const mine = (links.data?.items ?? []).filter(link => link.subject.type === 'grow' && link.subject.id === grow.id);

  return (
    <Sheet title={t('sharing.title', { name: grow.name })} onClose={onClose}>
      <div className={styles.body}>
        <section className={styles.block}>
          <div className={styles.switchRow}>
            <div className={styles.switchText}>
              <span className={styles.blockTitle}>
                {t('sharing.publicPage')}
                <Help topic="publicPage" />
              </span>
              <span className={ui.note}>{t('sharing.publicPageNote')}</span>
            </div>
            <button
              type="button"
              className={ui.switch}
              role="switch"
              aria-checked={isPublic}
              aria-label={t('sharing.publicPage')}
              disabled={update.isPending}
              onClick={() => update.mutate({ visibility: isPublic ? 'private' : 'public' })}
            >
              <span className={ui.knob} aria-hidden />
            </button>
          </div>

          {isPublic ? (
            <div className={styles.addressRow}>
              <code className={`mono ${styles.address}`}>{appUrl(`/g/${grow.slug}`)}</code>
              <CopyButton value={appUrl(`/g/${grow.slug}`)} label={t('sharing.copyAddress')} />
            </div>
          ) : null}

          {update.error ? <Refused error={update.error} /> : null}
        </section>

        <section className={styles.block}>
          <div className={styles.switchRow}>
            <div className={styles.switchText}>
              <span className={styles.blockTitle}>
                {t('sharing.links')}
                <Help topic="linkActions" />
              </span>
              <span className={ui.note}>{t('sharing.linksNote')}</span>
            </div>
            {drafting ? null : (
              <button type="button" className={`${ui.button} ${ui.primary}`} onClick={() => setDrafting(true)}>
                {t('sharing.newLink')}
              </button>
            )}
          </div>

          {drafting ? (
            <Editor
              busy={create.isPending}
              error={create.error}
              submitLabel={t('sharing.createLink')}
              onCancel={() => setDrafting(false)}
              onSubmit={draft =>
                create.mutate(
                  {
                    // Every link this app makes is a key to a diary. The other
                    // kind the contract names is a page, and a page is the
                    // grow's own visibility rather than something handed out.
                    kind: 'view',
                    subject: { type: 'grow', id: grow.id },
                    range: rangeOf(draft, zone),
                    includeCameras: draft.includeCameras,
                    expiresAt: instantOf(draft.expires, 'end', zone),
                  },
                  { onSuccess: () => setDrafting(false) },
                )
              }
            />
          ) : null}

          {links.isPending ? <p className={ui.note}>{t('home.waiting')}</p> : null}
          {!links.isPending && mine.length === 0 && !drafting ? <p className={ui.note}>{t('sharing.noLinks')}</p> : null}

          <ul className={styles.links}>
            {mine.map(link => (
              <LinkRow key={link.id} link={link} now={now} />
            ))}
          </ul>
        </section>
      </div>
    </Sheet>
  );
}

/** One link: where it points, what it lets through, how often it has been opened, and what can still be done to it. */
function LinkRow({ link, now }: { link: ShareLink; now: DateTime }) {
  const { t } = useTranslation();
  const zone = useZone();
  const [narrowing, setNarrowing] = useState(false);
  const update = useUpdateShareLink();
  const revoke = useRevokeShareLink();
  const remove = useDeleteShareLink();

  const address = appUrl(`/shared/${link.token}`);
  const dead = link.revokedAt !== null || (link.expiresAt !== null && DateTime.fromISO(link.expiresAt) <= now);

  return (
    <li className={styles.link} data-dead={dead}>
      <div className={styles.addressRow}>
        <code className={`mono ${styles.address}`}>{address}</code>
        {dead ? null : <CopyButton value={address} label={t('sharing.copyLink')} />}
      </div>

      <p className={`mono ${styles.linkMeta}`}>{describe(t, link, now, zone)}</p>

      {narrowing ? (
        <Editor
          busy={update.isPending}
          error={update.error}
          initial={{
            from: dayOf(link.range.startsAt, zone),
            to: dayOf(link.range.endsAt, zone),
            expires: dayOf(link.expiresAt, zone),
            includeCameras: link.includeCameras,
          }}
          submitLabel={t('sharing.save')}
          onCancel={() => setNarrowing(false)}
          onSubmit={draft =>
            update.mutate(
              {
                id: link.id,
                body: { range: rangeOf(draft, zone), includeCameras: draft.includeCameras, expiresAt: instantOf(draft.expires, 'end', zone) },
              },
              { onSuccess: () => setNarrowing(false) },
            )
          }
        />
      ) : (
        <div className={styles.linkActions}>
          {dead ? null : (
            <button type="button" className={ui.chip} onClick={() => setNarrowing(true)}>
              {t('sharing.narrow')}
            </button>
          )}
          {link.revokedAt === null ? (
            <button type="button" className={ui.chip} disabled={revoke.isPending} onClick={() => revoke.mutate(link.id)}>
              {t('sharing.revoke')}
            </button>
          ) : null}
          <button type="button" className={`${ui.chip} ${styles.forget}`} disabled={remove.isPending} onClick={() => remove.mutate(link.id)}>
            {t('sharing.forget')}
          </button>
        </div>
      )}

      {revoke.error ? <Refused error={revoke.error} /> : null}
      {remove.error ? <Refused error={remove.error} /> : null}
    </li>
  );
}

interface Draft {
  from: string;
  to: string;
  expires: string;
  includeCameras: boolean;
}

const EMPTY: Draft = { from: '', to: '', expires: '', includeCameras: false };

/**
 * The four things a link carries, used both to make one and to narrow one that
 * is already out. What it points at is not among them on purpose: the address
 * is in somebody else's hands, and repointing it would show them something they
 * were never sent.
 */
function Editor({
  initial = EMPTY,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Draft;
  submitLabel: string;
  busy: boolean;
  error: unknown;
  onSubmit: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));

  return (
    <div className={styles.editor}>
      <div className={styles.fields}>
        <Field label={t('sharing.from')} value={draft.from} hint={t('sharing.fromStart')} help="shareWindow" onChange={value => set('from', value)} />
        <Field label={t('sharing.to')} value={draft.to} hint={t('sharing.toOpen')} onChange={value => set('to', value)} />
        <Field label={t('sharing.expires')} value={draft.expires} hint={t('sharing.never')} onChange={value => set('expires', value)} />
      </div>

      <div className={styles.switchRow}>
        <div className={styles.switchText}>
          <span>{t('sharing.cameras')}</span>
          <span className={ui.note}>{t('sharing.camerasNote')}</span>
        </div>
        <button
          type="button"
          className={ui.switch}
          role="switch"
          aria-checked={draft.includeCameras}
          aria-label={t('sharing.cameras')}
          onClick={() => set('includeCameras', !draft.includeCameras)}
        >
          <span className={ui.knob} aria-hidden />
        </button>
      </div>

      {error ? <Refused error={error} /> : null}

      <div className={styles.linkActions}>
        <button type="button" className={`${ui.button} ${ui.primary}`} disabled={busy} onClick={() => onSubmit(draft)}>
          {busy ? t('sharing.saving') : submitLabel}
        </button>
        <button type="button" className={ui.button} onClick={onCancel}>
          {t('sharing.cancel')}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  hint,
  help,
  onChange,
}: {
  label: string;
  value: string;
  hint: string;
  help?: HelpTopic;
  onChange: (value: string) => void;
}) {
  // Pointed at by id, because a label names the first control inside it and the (i) would come first.
  const id = useId();

  return (
    <label className={styles.field} htmlFor={id}>
      <span className="label">
        {label}
        {help ? <Help topic={help} /> : null}
      </span>
      <input
        id={id}
        className={`${ui.input} ${styles.date}`}
        type="date"
        value={value}
        placeholder={hint}
        aria-label={help ? label : undefined}
        onChange={event => onChange(event.target.value)}
      />
      <span className={`mono ${styles.hint}`}>{value ? '' : hint}</span>
    </label>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "1 Sep → open end · with pictures · opened 3× · last 2 h ago", and what stopped it where something did. */
const describe = (t: Translate, link: ShareLink, now: DateTime, zone: string | null): string => {
  const day = (at: string) => calendarDay(at, zone);
  const parts = [
    link.range.startsAt === null
      ? link.range.endsAt === null
        ? t('sharing.window.all')
        : t('sharing.window.until', { to: day(link.range.endsAt) })
      : link.range.endsAt === null
        ? t('sharing.window.since', { from: day(link.range.startsAt) })
        : t('sharing.window.between', { from: day(link.range.startsAt), to: day(link.range.endsAt) }),
    t(link.includeCameras ? 'sharing.withPictures' : 'sharing.withoutPictures'),
    t('sharing.opened', { count: link.state.openCount }),
  ];

  if (link.state.lastOpenedAt) parts.push(t('sharing.lastOpened', { age: ageLabel(link.state.lastOpenedAt, now) }));
  if (link.revokedAt) parts.push(t('sharing.revokedOn', { date: day(link.revokedAt) }));
  else if (link.expiresAt)
    parts.push(t(DateTime.fromISO(link.expiresAt) <= now ? 'sharing.expiredOn' : 'sharing.expiresOn', { date: day(link.expiresAt) }));

  return parts.join(' · ');
};

/**
 * A date the field holds, as the instant the contract takes: the whole of that
 * day where the account is.
 *
 * The day is the grower's, so its edges are the grower's midnights. Cut at the
 * browser's instead, a window typed as 1 September to 23 September left on the
 * wire as 31 August 22:00 to 23 September 21:59 - it carried the last two hours
 * of a day that was excluded, including a diary line standing in them, and
 * dropped the last two hours of a day that was included. `dayOf` reads the
 * stored instant back in the same zone, so the field shows the day that was
 * typed, and `describe` above already names the window with `calendarDay`
 * there: one sheet cannot hold two answers to which day a link begins on.
 */
const instantOf = (day: string, edge: 'start' | 'end', zone: string | null): string | null => {
  if (!day) return null;
  const at = DateTime.fromISO(day, { zone: zone ?? undefined });

  return (edge === 'start' ? at.startOf('day') : at.endOf('day')).toUTC().toISO();
};

const dayOf = (at: string | null, zone: string | null): string => (at ? zoned(at, zone).toFormat('yyyy-MM-dd') : '');

/** An open end is a link that keeps up with the diary as it goes on, which is what sharing a running grow means. */
const rangeOf = (draft: Draft, zone: string | null): TimeRange => ({
  startsAt: instantOf(draft.from, 'start', zone),
  endsAt: instantOf(draft.to, 'end', zone),
});
