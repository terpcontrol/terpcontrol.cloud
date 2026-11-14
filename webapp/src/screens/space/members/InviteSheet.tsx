import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Invite, MemberRole } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useCreateInvite } from '@/api/invites';
import { useDiaryLayer } from '@/api/layers';
import { Sheet } from '@/ui/Sheet';
import { useCopied } from '@/ui/clipboard';
import { CopyButton } from '@/ui/CopyButton';
import { Refused } from '@/ui/PageState';
import { QrCode } from '@/ui/QrCode';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { InviteAddress, InviteTerms } from './InviteTerms';
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
 * server has cut it. First the two questions - the role and the validity,
 * what a guest will and will not see behind the second's help -; then, once
 * the server has answered, the code it answered, and under it what that code
 * grants read off the answer rather than off what was asked for. A code that
 * is already out opens the sheet on its second screen, so a host at a meeting
 * can show yesterday's link as a QR without cutting another.
 */
export function InviteSheet({
  spaceId,
  spaceName,
  room = false,
  shown,
  onClose,
}: {
  spaceId: string;
  spaceName: string;
  /** Whether it is a room's invitation, which lets into every place of the room. */
  room?: boolean;
  /** A code already out, to be shown rather than made; null asks the two questions first. */
  shown: Invite | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateInvite(spaceId);
  // Without the diary there are no entries or tasks for a role to be about, so each role is said in what is there.
  const diary = useDiaryLayer();
  const [made, setMade] = useState<Invite | null>(shown);
  const [role, setRole] = useState<MemberRole>('can_log');
  const [validity, setValidity] = useState<Validity>('week');

  // The place's name stands by itself, as the sheet's second line and in what a share is headed by.
  const title = t('space.members.sheet.title');

  if (made) {
    return (
      <Sheet
        title={title}
        note={spaceName}
        onClose={onClose}
        actions={
          <>
            <ShareButton url={inviteAddress(made.code)} title={`${t('space.members.join.label')} · ${spaceName}`} />
            <button type="button" className={ui.button} onClick={onClose}>
              {t('space.members.sheet.done')}
            </button>
          </>
        }
      >
        <div className={styles.sheetBody}>
          {/* A code already out was opened by "Code · QR", so it opens on the code; one just made on its link. */}
          <Made invite={made} first={shown ? 'code' : 'link'} />
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={title}
      note={spaceName}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={create.isPending}
          // The instant is taken at the tap rather than from a clock that ticks
          // every ten seconds, so the week is a week from when it was asked for -
          // on the server's clock, which is the one that will let it run out.
          onClick={() => create.mutate({ role, expiresAt: expiresAtFor(validity, serverNow()) }, { onSuccess: setMade })}
        >
          {create.isPending ? t('space.members.sheet.making') : t('space.members.sheet.make')}
        </button>
      }
    >
      <div className={styles.sheetBody}>
        <Block label={t('space.members.sheet.role')} help="memberRole">
          <div className={styles.roles} role="radiogroup" aria-label={t('space.members.sheet.role')}>
            {ROLES.map(one => (
              <button key={one} type="button" role="radio" aria-checked={role === one} className={styles.role} onClick={() => setRole(one)}>
                <span className={styles.roleName}>{t(`space.members.role.${one}`)}</span>
                <span className={styles.roleNote}>{t(`space.members.sheet.roleNote.${one}${diary ? '' : 'Plain'}${room ? 'Room' : ''}`)}</span>
              </button>
            ))}
          </div>
        </Block>

        <Block label={t('space.members.sheet.valid')} help="invite">
          <Choices label={t('space.members.sheet.valid')}>
            {VALIDITIES.map(one => (
              <Choice key={one} chosen={validity === one} onChoose={() => setValidity(one)}>
                {t(`space.members.sheet.validity.${one}`)}
              </Choice>
            ))}
          </Choices>
        </Block>

        <Refused error={create.error} />
      </div>
    </Sheet>
  );
}

/** The code the server answered, three ways, and under it what it grants - from the answer. */
function Made({ invite, first }: { invite: Invite; first: Way }) {
  const { t } = useTranslation();
  const [way, setWay] = useState<Way>(first);
  const address = inviteAddress(invite.code);

  return (
    <div className={`${ui.stack2} ${styles.made}`}>
      <div className={`${ui.segments} ${ui.segmentsFill}`} role="tablist" aria-label={t('space.members.sheet.waysLabel')}>
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
          <div className={`${ui.row2} ${styles.addressRow}`}>
            <InviteAddress code={invite.code} />
            <CopyButton value={address} label={t('space.members.copyLink')} />
          </div>
        ) : way === 'code' ? (
          <>
            <code className={styles.code}>{invite.code}</code>
            <p className={styles.hint}>{t('space.members.sheet.codeHint', { address: codeEntryAddress() })}</p>
            <CopyButton value={invite.code} label={t('space.members.sheet.copyCode')} />
          </>
        ) : (
          <>
            <QrCode value={address} label={t('space.members.sheet.qrLabel', { address: shownAddress(invite.code) })} />
            <p className={styles.hint}>{t('space.members.sheet.qrHint')}</p>
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
  const [state, copy] = useCopied();
  const canShare = typeof navigator.share === 'function';

  const share = async () => {
    if (canShare) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    await copy(url);
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
