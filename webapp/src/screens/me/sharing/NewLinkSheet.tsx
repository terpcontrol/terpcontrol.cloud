import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { GrowListItem, GrowOrSpaceRef, ShareKind, ShareLink, Space } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useCameras } from '@/api/cameras';
import { useCreateShareLink } from '@/api/sharing';
import { Sheet } from '@/log/Sheet';
import { instantOf } from '@/ui/age';
import { Refused } from '@/ui/PageState';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { Switch } from '../privacy/parts';
import styles from './sharing.module.css';

/**
 * Making a link: the four things the board's row names - a grow or a tent, the
 * kind, the cams, the expiry - and nothing else.
 *
 * A range is asked for only where the screen it was opened from was showing
 * one - the charts, stepped back or zoomed - and is then what the link shows
 * unless the grower takes it as a whole. Otherwise what a reader sees through
 * the link is clamped by the server to what the grant allows - a grow's own
 * life, a tent as it stands - and the range is left out rather than invented.
 *
 * A public page is permanent until the grow is made private, which is a
 * sentence and not a date, so the expiry row gives way to it. It is offered
 * only for a grow that is public now: the server answers a public-page link
 * whatever the grow's visibility, so a link made onto a private grow would be
 * a promise this screen could not keep.
 */

/** How long a read-only link lasts, in the round numbers a person means; null is never. */
const LIFETIMES: (number | null)[] = [7, 30, 90, null];

/** A window the link may be held to: the one the charts were showing, and how they named it. */
export interface ShareWindow {
  startsAt: string;
  endsAt: string;
  label: string;
}

export function NewLinkSheet({
  grows,
  spaces,
  window = null,
  onClose,
  onCreated,
}: {
  grows: GrowListItem[];
  spaces: Space[];
  /** The stretch a screen was showing, offered as what the link shows; none shares the subject as it stands. */
  window?: ShareWindow | null;
  onClose: () => void;
  /** Where the link just made is handed, for a screen that shows it at once rather than in the list of links. */
  onCreated?: (link: ShareLink) => void;
}) {
  const { t } = useTranslation();
  const create = useCreateShareLink();
  const cameras = useCameras();
  const [limited, setLimited] = useState(window !== null);
  const [subject, setSubject] = useState<GrowOrSpaceRef | null>(() =>
    grows[0] ? { type: 'grow', id: grows[0].id } : spaces[0] ? { type: 'space', id: spaces[0].id } : null,
  );
  const [kind, setKind] = useState<ShareKind>('view');
  const [cams, setCams] = useState(false);
  const [days, setDays] = useState<number | null>(7);

  const grow = subject?.type === 'grow' ? grows.find(row => row.id === subject.id) : undefined;
  // Pictures are offered only where a camera could have taken any: a place with none has nothing to include.
  const camerasHere = (cameras.data?.items ?? []).some(camera => subject?.type !== 'space' || camera.spaceId === subject.id);
  const growIsPublic = grow?.visibility === 'public';
  const blocked = kind === 'public_page' && !growIsPublic;
  const ready = subject !== null && !blocked && !create.isPending;

  const choose = (ref: GrowOrSpaceRef) => {
    setSubject(ref);
    // A tent has no public page, so the kind follows the subject rather than staying on an answer that is no longer offered.
    if (ref.type === 'space') setKind('view');
  };

  const submit = () => {
    if (!subject) return;
    create.mutate(
      {
        kind,
        subject,
        ...(limited && window && kind === 'view' ? { range: { startsAt: window.startsAt, endsAt: window.endsAt } } : {}),
        includeCameras: cams && camerasHere,
        expiresAt: kind === 'public_page' || days === null ? null : instantOf(serverNow().plus({ days })),
      },
      { onSuccess: link => (onCreated ? onCreated(link) : onClose()) },
    );
  };

  return (
    <Sheet
      title={t('me.shareLinks.sheet.title')}
      onClose={onClose}
      actions={
        <div className={styles.actions}>
          <button type="button" className={`${ui.button} ${ui.primary}`} disabled={!ready} onClick={submit}>
            {create.isPending ? t('sharing.saving') : t('me.shareLinks.sheet.create')}
          </button>
          <button type="button" className={ui.button} onClick={onClose}>
            {t('sharing.cancel')}
          </button>
        </div>
      }
    >
      <div className={styles.sheetBody}>
        <Block label={t('me.shareLinks.sheet.subject')} help="spaceLink">
          {grows.length + spaces.length === 0 ? (
            /* The screen no longer offers the card at all where there is
               nothing to hand out, so this is only what a list emptied under
               an open sheet falls back to - and it says the same thing. */
            <p className={ui.note}>{t('me.shareLinks.noSubjects')}</p>
          ) : (
            <Choices label={t('me.shareLinks.sheet.subject')}>
              {grows.map(row => (
                <Choice key={row.id} chosen={subject?.type === 'grow' && subject.id === row.id} onChoose={() => choose({ type: 'grow', id: row.id })}>
                  {row.name}
                </Choice>
              ))}
              {spaces.map(row => (
                <Choice
                  key={row.id}
                  chosen={subject?.type === 'space' && subject.id === row.id}
                  onChoose={() => choose({ type: 'space', id: row.id })}
                >
                  {row.name}
                </Choice>
              ))}
            </Choices>
          )}
        </Block>

        <Block label={t('me.shareLinks.sheet.kind')}>
          <Choices label={t('me.shareLinks.sheet.kind')}>
            <Choice chosen={kind === 'public_page'} disabled={grow === undefined} onChoose={() => setKind('public_page')}>
              {t('me.shareLinks.sheet.publicPage')}
            </Choice>
            <Choice chosen={kind === 'view'} onChoose={() => setKind('view')}>
              {t('me.shareLinks.sheet.view')}
            </Choice>
          </Choices>
          {kind === 'view' ? (
            <p className={`${ui.note} ${styles.sentence}`}>{t('me.shareLinks.sheet.viewNote')}</p>
          ) : blocked ? (
            <p className={`${ui.note} ${styles.sentence}`}>
              {t('me.shareLinks.sheet.needsPublic', { name: grow?.name })} <Link to="/me/public">{t('me.public.title')}</Link>
            </p>
          ) : (
            <p className={`${ui.note} ${styles.sentence}`}>{t('me.shareLinks.sheet.untilPrivate')}</p>
          )}
        </Block>

        {window && kind === 'view' ? (
          <Block label={t('me.shareLinks.sheet.window')}>
            <Choices label={t('me.shareLinks.sheet.window')}>
              <Choice chosen={limited} onChoose={() => setLimited(true)}>
                {window.label}
              </Choice>
              <Choice chosen={!limited} onChoose={() => setLimited(false)}>
                {t('me.shareLinks.sheet.wholeWindow')}
              </Choice>
            </Choices>
            <p className={`${ui.note} ${styles.sentence}`}>{t(limited ? 'me.shareLinks.sheet.windowNote' : 'me.shareLinks.sheet.wholeWindowNote')}</p>
          </Block>
        ) : null}

        {camerasHere ? (
          <Block label={t('me.shareLinks.sheet.cams')}>
            <div className={styles.switchRow}>
              {/* The words switch it as well as the switch does. */}
              <div className={styles.switchText} onClick={() => setCams(!cams)}>
                <span>{t('sharing.cameras')}</span>
                <span className={ui.note}>{t('sharing.camerasNote')}</span>
              </div>
              <Switch name={t('sharing.cameras')} on={cams} onToggle={() => setCams(!cams)} />
            </div>
          </Block>
        ) : null}

        {kind === 'view' ? (
          <Block label={t('me.shareLinks.sheet.expiry')}>
            <Choices label={t('me.shareLinks.sheet.expiry')}>
              {LIFETIMES.map(lifetime => (
                <Choice key={lifetime ?? 'never'} chosen={days === lifetime} onChoose={() => setDays(lifetime)}>
                  {lifetime === null ? t('me.shareLinks.sheet.never') : t('me.shareLinks.days', { count: lifetime })}
                </Choice>
              ))}
            </Choices>
          </Block>
        ) : null}

        <Refused error={create.error} />
      </div>
    </Sheet>
  );
}
