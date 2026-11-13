import { CameraOff, Clock } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import type { SharedCurves, SharedResolution } from '@fg2/shared-types/v1';
import { sharedPicture, useSharedLink, useSharedWeeks, type Picture } from '@/api/public';
import { ageLabel } from '@/ui/age';
import { unbroken } from '@/ui/fact-text';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { calendarDay } from '@/ui/zone';
import { SharedTimeline } from '../timeline/Timeline';
import { Diary } from './Diary';
import { PublicShell, PublicUnread } from './PublicShell';
import { SharedSpace } from './SharedSpace';
import { windowIsCurrent } from './window';
import styles from './Public.module.css';

/**
 * `/shared/{token}`: a diary or a tent, read through a key somebody was handed;
 * a tent with its Timeline, and a diary for a stretch of days with the curves
 * of where it stood then.
 *
 * The token is the reader's whole proof and the server never hands back the
 * link behind it - not who made it, not how often it has been opened - so this
 * screen knows exactly what it shows: a window, whether pictures are part of
 * it, and the thing itself. What the reader is inside is said plainly at the
 * top, because a diary that stops three weeks short is otherwise a diary that
 * looks abandoned.
 */
export function SharedRoute() {
  const { token = '' } = useParams();
  const now = useNow();
  const link = useSharedLink(token);
  // A link onto a tent has no weeks to page through, so there is no cursor to
  // follow and nothing is ever asked for.
  const diary = link.data?.subject.type === 'grow' ? link.data.subject.grow : null;
  const earlier = useSharedWeeks(token, diary?.weeksCursor ?? null);

  if (!link.data) return <PublicUnread read={link} lines={4} titleKey="publicPage.deadLink.title" bodyKey="publicPage.deadLink.body" />;

  const { subject } = link.data;
  const banner = <WindowBanner resolution={link.data} now={now} />;
  const picture = sharedPicture(token);

  // An older server answers no curves.
  const curves = subject.type === 'grow' ? (subject.curves ?? []) : [];

  return subject.type === 'grow' ? (
    <PublicShell title={subject.grow.name}>
      <Diary
        page={subject.grow}
        picture={picture}
        now={now}
        banner={banner}
        earlier={earlier}
        curves={curves.length > 0 ? <LinkCurves token={token} curves={curves} picture={picture} /> : null}
      />
    </PublicShell>
  ) : (
    <PublicShell title={subject.space.name}>
      <SharedSpace space={subject.space} token={token} picture={picture} now={now} banner={banner} />
    </PublicShell>
  );
}

/** What a view of Verlauf is named by in the address; any of them means somebody has moved it already. */
const VIEW_KEYS = ['range', 'from', 'to', 'last', 'at'];

/**
 * The curves of the places a diary stood in during the stretch the link carries, as a link onto a place shows its
 * own: Verlauf read through the link, opened on that stretch - which is what was showing where the link was made -
 * and clamped by the server to the grow's stay in each place.
 */
function LinkCurves({ token, curves, picture }: { token: string; curves: SharedCurves[]; picture: Picture }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [from, to] = [curves[0].range.startsAt, curves[curves.length - 1].range.endsAt];
  const named = VIEW_KEYS.some(key => params.has(key));
  // Drawn once the address names a view, and from then on: the chip "24 h" is written as no parameter at all.
  const [opened, setOpened] = useState(named || !from || !to);
  if (named && !opened) setOpened(true);

  useEffect(() => {
    if (!opened && from && to) setParams(current => new URLSearchParams([...current, ['from', from], ['to', to]]), { replace: true });
  }, [opened, from, to, setParams]);

  if (!opened) return null;

  return curves.map(place => (
    <section key={place.spaceId} className={ui.stack2}>
      <SharedTimeline spaceId={place.spaceId} shared={{ token, picture }} title={<h2>{t('publicPage.timelineOf', { name: place.name })}</h2>} />
    </section>
  ));
}

/**
 * The window, in words. An open end is clamped to the instant the server
 * answered, so it is also how current the page is: where that instant is no
 * longer now, the banner dims with the rest of the page and says how old what
 * is under it is.
 */
function WindowBanner({ resolution, now }: { resolution: SharedResolution; now: DateTime }) {
  const { t } = useTranslation();
  const { startsAt, endsAt } = resolution.range;
  const current = windowIsCurrent(endsAt, now);
  const day = (at: string) => calendarDay(at, null);

  const window =
    startsAt === null
      ? endsAt === null || current
        ? t('publicPage.window.all')
        : t('publicPage.window.until', { to: day(endsAt) })
      : endsAt === null || current
        ? t('publicPage.window.since', { from: day(startsAt) })
        : t('publicPage.window.between', { from: day(startsAt), to: day(endsAt) });

  return (
    <aside className={styles.banner} data-age={current ? undefined : 'stale'}>
      <p className={styles.bannerLine}>
        <Clock size={13} strokeWidth={1.75} aria-hidden />
        {window}
        {endsAt !== null && !current ? ` · ${unbroken(t('publicPage.asOf', { age: ageLabel(endsAt, now) }))}` : ''}
      </p>
      {resolution.includeCameras ? null : (
        <p className={styles.bannerLine}>
          <CameraOff size={13} strokeWidth={1.75} aria-hidden />
          {t('publicPage.noCameras')}
        </p>
      )}
      {resolution.expiresAt ? <p className={styles.bannerLine}>{t('publicPage.expires', { date: day(resolution.expiresAt) })}</p> : null}
    </aside>
  );
}
