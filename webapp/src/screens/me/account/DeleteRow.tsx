import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useDeleteAccount } from '@/api/account';
import { factsOf } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';
import { Sheet } from '@/ui/Sheet';
import { matchesHandle, typedHandle } from '@/ui/handle';
import { Refused } from '@/ui/PageState';
import { HandleField } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { Row } from '../parts';
import parts from '../parts.module.css';
import styles from './Account.module.css';
import { Answer } from '@/ui/Asking';

/**
 * The end of the account, which is the one thing on its page that cannot be
 * taken back.
 *
 * So the sheet asks for the handle to be typed rather than for a tap to be
 * repeated: a confirmation that is one more tap is answered by the same
 * reflex that opened it, and this is the only control in the app where being
 * wrong costs everything. What it says it will do is what the server does -
 * the rows are deleted rather than hidden, whoever was let into the account's
 * places loses them, and the hardware goes back to being claimable by whoever
 * holds it. The sign-in page it ends on says that the account is gone.
 */
export function DeleteRow({ handle, disabled }: { handle: string; disabled: boolean }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);

  return (
    <>
      <Row title={t('me.account.delete.title')} line={<Facts facts={factsOf(t('me.account.delete.line'))} />} danger help="deleteAccount">
        <button type="button" className={`${ui.chip} ${ui.danger}`} disabled={disabled} onClick={() => setAsking(true)}>
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
  // The session ends with the answer and takes this sheet with it, so the way on hangs on the write itself.
  const gone = () => navigate('/sign-in', { replace: true, state: { deleted: true } });

  return (
    <Sheet
      title={t('me.account.delete.title')}
      onClose={onClose}
      actions={
        <Answer
          yes={t('me.account.delete.yes')}
          danger
          disabled={!sure || remove.isPending}
          onYes={() => void remove.mutateAsync().then(gone, () => undefined)}
          onCancel={onClose}
        />
      }
    >
      <div className={styles.asked}>
        <p>{t('me.account.delete.what')}</p>
        <p>{t('me.account.delete.grows')}</p>
        <HandleField className={parts.field} label={t('me.account.delete.typeHandle', { handle })} value={typed} onChange={setTyped} />
        {typedHandle(typed) !== '' && !sure ? <p className={ui.problem}>{t('me.account.delete.notHandle')}</p> : null}
        <Refused error={remove.error} />
      </div>
    </Sheet>
  );
}
