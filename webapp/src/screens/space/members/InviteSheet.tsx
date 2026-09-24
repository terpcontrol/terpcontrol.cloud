import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Invite, MemberRole, SpaceKind } from '@fg2/shared-types/v1';
import { useCreateInvite } from '@/api/invites';
import { useSpaceOverview } from '@/api/spaces';
import { Sheet } from '@/log/Sheet';
import { copyText } from '@/ui/clipboard';
import { CopyButton } from '@/ui/CopyButton';
import { Refused } from '@/ui/PageState';
import { QrCode } from '@/ui/QrCode';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { InviteTerms } from './InviteTerms';
import { codeEntryAddress, expiresAtFor, inviteAddress, ROLES, shownAddress, VALIDITIES, type Validity } from './invites';
import styles from './Invite.module.css';

/** The three ways a code is handed over, in the order the board draws them. */
const WAYS = ['link', 'code', 'qr'] as const;
type Way = (typeof WAYS)[number];

/**
 * The invitation, as the board draws it: what the link will let somebody do,
 * how long it lives, and then the link itself as an address, as eight
 * characters to read aloud, and as a square to hold a phone up to.
 *
 * It is two screens on one sheet because the link does not exist until the
 * server has cut it. First the two questions - the role and the validity - and
 * the sentence that says what the guest will and will not see; then, once the
 * server has answered, the code it answered, and under it what that code
 * grants read off the answer rather than off what was asked for. A code that
 * is already out opens the sheet on its second screen, so a host at a meeting
 * can show yesterday's link as a QR without cutting another.
 */
export function InviteSheet({
  spaceId,
  spaceName,
  kind,
  shown,
  onClose,
}: {
  spaceId: string;
  spaceName: string;
  kind: SpaceKind;
  /** A code already out, to be shown rather than made; null asks the two questions first. */
  shown: Invite | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateInvite(spaceId);
  const [made, setMade] = useState<Invite | null>(shown);
  const [role, setRole] = useState<MemberRole>('can_log');
  const [validity, setValidity] = useState<Validity>('week');

  const title = t('space.members.sheet.title', { name: spaceName });

  if (made) {
    return (
      <Sheet
        title={title}
        onClose={onClose}
        actions={
          <>
            <ShareButton url={inviteAddress(made.code)} title={title} />
            <button type="button" className={ui.button} onClick={onClose}>
              {t('space.members.sheet.done')}
            </button>
          </>
        }
      >
        <div className={styles.sheetBody}>
          <Made invite={made} />
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={title}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={create.isPending}
          // The instant is taken at the tap rather than from a clock that ticks
          // every ten seconds, so the week is a week from when it was asked for.
          onClick={() => create.mutate({ role, expiresAt: expiresAtFor(validity, DateTime.now()) }, { onSuccess: setMade })}
        >
          {create.isPending ? t('space.members.sheet.making') : t('space.members.sheet.make')}
        </button>
      }
    >
      <div className={styles.sheetBody}>
        <Block label={t('space.members.sheet.role')}>
          <div className={styles.roles} role="radiogroup" aria-label={t('space.members.sheet.role')}>
            {ROLES.map(one => (
              <button key={one} type="button" role="radio" aria-checked={role === one} className={styles.role} onClick={() => setRole(one)}>
                <span className={styles.roleName}>{t(`space.members.role.${one}`)}</span>
                <span className={styles.roleNote}>{t(`space.members.sheet.roleNote.${one}`)}</span>
              </button>
            ))}
          </div>
        </Block>

        <Block label={t('space.members.sheet.valid')}>
          <Choices label={t('space.members.sheet.valid')}>
            {VALIDITIES.map(one => (
              <Choice key={one} chosen={validity === one} onChoose={() => setValidity(one)}>
                {t(`space.members.sheet.validity.${one}`)}
              </Choice>
            ))}
          </Choices>
        </Block>

        <WhatTheySee spaceId={spaceId} spaceName={spaceName} kind={kind} />
        <Refused error={create.error} />
      </div>
    </Sheet>
  );
}

/**
 * The board's sentence: that the guest needs an account of their own, what
 * they will see, and what they will not. What they will see names the grows
 * standing here when the tent's overview is already in hand - it is the page
 * this sheet opens over, so it costs nothing - and says "what is growing in
 * it" when it is not, rather than waiting for a read to finish a sentence.
 */
function WhatTheySee({ spaceId, spaceName, kind }: { spaceId: string; spaceName: string; kind: SpaceKind }) {
  const { t } = useTranslation();
  const overview = useSpaceOverview(spaceId);
  const grows = overview.data?.grows.map(grow => grow.name) ?? [];

  const what =
    kind === 'room'
      ? t('space.members.sheet.seesRoom', { name: spaceName })
      : t('space.members.sheet.sees', {
          what: [spaceName, ...(grows.length > 0 ? grows : [t('space.members.sheet.whatGrows')]), t('space.members.sheet.theCams')].join(', '),
        });

  return (
    <p className={styles.sentence}>
      {t('space.members.sheet.needAccount')} {what} {t('space.members.sheet.doesNotSee')}
    </p>
  );
}

/** The code the server answered, three ways, and under it what it grants - from the answer. */
function Made({ invite }: { invite: Invite }) {
  const { t } = useTranslation();
  const [way, setWay] = useState<Way>('link');
  const address = inviteAddress(invite.code);

  return (
    <div className={styles.made}>
      <div className={`${ui.segments} ${styles.ways}`} role="tablist" aria-label={t('space.members.sheet.waysLabel')}>
        {WAYS.map(one => (
          <button
            key={one}
            type="button"
            role="tab"
            id={`invite-way-${one}`}
            aria-selected={way === one}
            aria-controls="invite-way-panel"
            className={ui.segment}
            onClick={() => setWay(one)}
          >
            {t(`space.members.sheet.ways.${one}`)}
          </button>
        ))}
      </div>

      <div id="invite-way-panel" role="tabpanel" aria-labelledby={`invite-way-${way}`} className={`${ui.card} ${styles.pane}`}>
        {way === 'link' ? (
          <div className={styles.addressRow}>
            <code className={`mono ${styles.address}`}>{shownAddress(invite.code)}</code>
            <CopyButton value={address} label={t('space.members.copyLink')} />
          </div>
        ) : way === 'code' ? (
          <>
            <code className={`mono ${styles.code}`}>{invite.code}</code>
            <p className={`mono ${styles.hint}`}>{t('space.members.sheet.codeHint', { address: codeEntryAddress() })}</p>
            <CopyButton value={invite.code} label={t('space.members.sheet.copyCode')} />
          </>
        ) : (
          <>
            <QrCode value={address} label={t('space.members.sheet.qrLabel', { address: shownAddress(invite.code) })} />
            <p className={`mono ${styles.hint}`}>{t('space.members.sheet.qrHint')}</p>
          </>
        )}
      </div>

      <InviteTerms invite={invite} className={styles.terms} />
    </div>
  );
}

/**
 * The board's one green button. Where the browser can hand an address to
 * another app it does that, and a share the person cancelled is not a
 * failure; everywhere else the button copies the address and says whether it
 * managed to, because a phone reached over plain HTTP is exactly the place a
 * clipboard is refused.
 */
function ShareButton({ url, title }: { url: string; title: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const canShare = typeof navigator.share === 'function';

  // Back to the offer on its own, so a second tap is not told about the first.
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  const share = async () => {
    if (canShare) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    setState((await copyText(url)) ? 'copied' : 'failed');
  };

  return (
    <button type="button" className={`${ui.button} ${ui.primary}`} onClick={() => void share()}>
      {state === 'copied'
        ? t('sharing.copied')
        : state === 'failed'
          ? t('space.members.sheet.copyFailed')
          : canShare
            ? t('space.members.sheet.share')
            : t('space.members.sheet.copyLink')}
    </button>
  );
}
