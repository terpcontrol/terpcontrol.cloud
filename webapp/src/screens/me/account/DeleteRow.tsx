import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useDeleteAccount } from '@/api/account';
import { Sheet } from '@/ui/Sheet';
import { matchesHandle, typedHandle } from '@/ui/handle';
import { Refused } from '@/ui/PageState';
import { HandleField } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { Row } from '../parts';
import styles from './Account.module.css';

/**
 * The end of the account, which is the one thing on its page that cannot be
 * taken back.
 *
 * So the sheet asks for the handle to be typed rather than for a tap to be
 * repeated: a confirmation that is one more tap is answered by the same
 * reflex that opened it, and this is the only control in the app where being
 * wrong costs everything. What it says it will do is what the server does -
 * the rows are deleted rather than hidden, and the hardware goes back to being
 * claimable by whoever holds it. The button that opens it is drawn as the
 * board's ellipsis, which read aloud is nothing at all, so it borrows the
 * row's title for its name: the one control that ends an account has to say so.
 */
export function DeleteRow({ handle, disabled }: { handle: string; disabled: boolean }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);

  return (
    <>
      <Row title={t('me.account.delete.title')} line={t('me.account.delete.line')} danger help="deleteAccount">
        <button
          type="button"
          className={`${ui.chip} ${ui.danger}`}
          aria-label={t('me.account.delete.title')}
          disabled={disabled}
          onClick={() => setAsking(true)}
        >
          {t('me.account.delete.open')}
        </button>
      </Row>
      {asking ? <DeleteSheet handle={handle} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

/**
 * The question itself: type the handle, and the button lives. What it asks for
 * has to be what it takes, so a mismatch says that it is one rather than
 * leaving the button grey with nothing on the screen saying why.
 */
function DeleteSheet({ handle, onClose }: { handle: string; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const remove = useDeleteAccount();
  const [typed, setTyped] = useState('');
  const sure = matchesHandle(typed, handle);

  return (
    <Sheet
      title={t('me.account.delete.title')}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={ui.dangerOutline}
          disabled={!sure || remove.isPending}
          onClick={() => remove.mutate(undefined, { onSuccess: () => void navigate('/sign-in', { replace: true }) })}
        >
          {t('me.account.delete.yes')}
        </button>
      }
    >
      <div className={styles.asked}>
        <p>{t('me.account.delete.what')}</p>
        <p>{t('me.account.delete.grows')}</p>
        <HandleField className={styles.field} label={t('me.account.delete.typeHandle', { handle })} value={typed} onChange={setTyped} />
        {typedHandle(typed) !== '' && !sure ? <p className={ui.problem}>{t('me.account.delete.notHandle')}</p> : null}
        <Refused error={remove.error} />
      </div>
    </Sheet>
  );
}
