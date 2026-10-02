import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useActivateAccount } from '@/api/account';
import { ApiError } from '@/api/problem';
import { refusalText } from '@/ui/refusal';
import ui from '@/ui/ui.module.css';
import { Door } from './Recover';
import styles from './SignIn.module.css';

/**
 * Where the activation mail leads: an install that asks for one sends the code
 * as a link to this page and as the code itself, so the field arrives filled
 * from the link and takes the code typed without one. It waits for the tap
 * rather than activating on arrival, because a mail program that opens links
 * to preview them would otherwise spend the code before its owner saw it.
 * Activating opens no session - the server answers it with nothing, so as not
 * to say whose account a code belonged to - so the page then sends the person
 * to sign in.
 */
export function Activate() {
  const { code = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activate = useActivateAccount();
  const [typed, setTyped] = useState(code);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setProblem(null);
    try {
      await activate.mutateAsync({ activationCode: typed.trim() });
      await navigate('/sign-in', { replace: true, state: { activated: true } });
    } catch (error) {
      setProblem(error instanceof ApiError && error.status === 404 ? t('activate.unknown') : refusalText(error));
    }
  };

  return (
    <Door title={t('activate.title')} onSubmit={() => void submit()}>
      <p className={styles.lead}>{t(code ? 'activate.fromLink' : 'activate.intro')}</p>
      <label className={`label ${styles.fieldLabel}`} htmlFor="activation-code">
        {t('login.signUp.activation.code')}
      </label>
      <input
        id="activation-code"
        className={`mono ${ui.input}`}
        autoComplete="one-time-code"
        autoCapitalize="none"
        spellCheck={false}
        disabled={activate.isPending}
        value={typed}
        onChange={event => setTyped(event.target.value)}
      />
      {problem ? (
        <p className={`${ui.problem} ${styles.problem}`} role="alert">
          {problem}
        </p>
      ) : null}
      <button className={`${ui.button} ${ui.primary} ${styles.submit}`} type="submit" disabled={activate.isPending || typed.trim() === ''}>
        {t('activate.submit')}
      </button>
      <p className={styles.links}>
        <Link to="/sign-in">{t('login.backToLogin')}</Link>
      </p>
    </Door>
  );
}
