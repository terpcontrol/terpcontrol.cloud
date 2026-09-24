import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useDeleteAccount } from '@/api/account';
import { Sheet } from '@/log/Sheet';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { Row } from '../parts';
import styles from './Privacy.module.css';

/**
 * The end of the account, which is the one thing on this screen that cannot be
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
      <Row title={t('me.privacy.delete.title')} line={t('me.privacy.delete.line')} danger help="deleteAccount">
        <button
          type="button"
          className={`${ui.chip} ${styles.danger}`}
          aria-label={t('me.privacy.delete.title')}
          disabled={disabled}
          onClick={() => setAsking(true)}
        >
          {t('me.privacy.delete.open')}
        </button>
      </Row>
      {asking ? <DeleteSheet handle={handle} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

/**
 * The question itself: type the handle, and the button lives.
 *
 * What it asks for has to be what it takes. The prompt is drawn in the small
 * caps this app labels with, so somebody whose handle is `admin` reads "TYPE
 * ADMIN TO CONFIRM", types ADMIN, and used to watch the button stay grey with
 * nothing on the screen saying why - and a phone capitalises the first letter
 * of a one-word handle whether they meant it or not. So the comparison ignores
 * case and the leading at-sign, the field is told not to capitalise or correct
 * what is typed into it, and a mismatch says that it is one rather than
 * refusing in silence. The gate is unchanged in the only way that matters:
 * the whole handle still has to be written out by hand.
 */
function DeleteSheet({ handle, onClose }: { handle: string; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const remove = useDeleteAccount();
  const [typed, setTyped] = useState('');
  const written = typed.trim().replace(/^@/, '');
  const sure = written.toLocaleLowerCase() === handle.toLocaleLowerCase();

  return (
    <Sheet
      title={t('me.privacy.delete.title')}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={`${ui.button} ${styles.dangerButton}`}
          disabled={!sure || remove.isPending}
          onClick={() => remove.mutate(undefined, { onSuccess: () => void navigate('/sign-in', { replace: true }) })}
        >
          {t('me.privacy.delete.yes')}
        </button>
      }
    >
      <p className={styles.sheetBody}>{t('me.privacy.delete.what')}</p>
      <p className={styles.sheetBody}>{t('me.privacy.delete.grows')}</p>
      <label className={styles.confirm}>
        <span className="label">{t('me.privacy.delete.typeHandle', { handle })}</span>
        <input
          className={`mono ${ui.input}`}
          value={typed}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={event => setTyped(event.target.value)}
        />
      </label>
      {written !== '' && !sure ? <p className={ui.problem}>{t('me.privacy.delete.notHandle')}</p> : null}
      <Refused error={remove.error} />
    </Sheet>
  );
}
