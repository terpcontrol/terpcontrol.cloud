import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useCheckReset, useRedeemReset, useRequestReset, useResetValid } from '@/api/account';
import { ApiError, refusalCode } from '@/api/problem';
import { refusalText } from '@/ui/refusal';
import ui from '@/ui/ui.module.css';
import { BackToSignIn, Door, Problem } from './Door';
import styles from './SignIn.module.css';

/**
 * A forgotten password, outside the shell like the sign-in it leads back to.
 *
 * Without a token it asks for the address and says a mail is on its way -
 * whether or not the address has an account here, because the server answers
 * both the same and so must the page. The mail carries a link to this page with
 * its token, and the same token as a code for somebody who reads it on another
 * device: "Enter the code" takes it typed and goes on as the link would, once
 * the server knows it - a code typed wrong is refused there, before a new
 * password has been thought of for it. With a token it asks for the new password and, once it is set, sends the person to
 * sign in with it; it opens no session of its own.
 */
export function Recover() {
  const { token } = useParams();

  return token ? <NewPassword token={token} /> : <AskForMail />;
}

type Asking = 'address' | 'sent' | 'code';

function AskForMail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const typed = (location.state as { email?: string } | null)?.email ?? '';
  const request = useRequestReset();
  const check = useCheckReset();
  const [stage, setStage] = useState<Asking>('address');
  const [email, setEmail] = useState(typed);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const send = async () => {
    setProblem(null);
    try {
      await request.mutateAsync({ email: email.trim() });
      setStage('sent');
    } catch (error) {
      setProblem(refusalText(error));
    }
  };

  const proceed = async () => {
    setProblem(null);
    const typed = code.trim();
    try {
      await check.mutateAsync(typed);
    } catch (error) {
      setProblem(refusalCode(error) === 'reset_unknown' ? t('recover.codeUnknown') : refusalText(error));
      return;
    }
    await navigate(`/recover/${encodeURIComponent(typed)}`, { state: { checked: true } });
  };

  return (
    <Door onSubmit={() => void (stage === 'code' ? proceed() : send())} title={t('recover.title')}>
      {stage === 'sent' ? (
        <p className={styles.lead} role="status">
          {t('recover.sent', { email: email.trim() })}
        </p>
      ) : (
        <p className={styles.lead}>{t(stage === 'code' ? 'recover.codeIntro' : 'recover.intro')}</p>
      )}

      {stage === 'address' ? (
        <>
          <label className={`label ${styles.fieldLabel}`} htmlFor="email">
            {t('login.email')}
          </label>
          <input
            id="email"
            className={ui.input}
            type="email"
            autoComplete="username"
            inputMode="email"
            disabled={request.isPending}
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
        </>
      ) : null}

      {stage === 'code' ? (
        <>
          <label className={`label ${styles.fieldLabel}`} htmlFor="recovery-code">
            {t('recover.code')}
          </label>
          <input
            id="recovery-code"
            className={ui.input}
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            value={code}
            onChange={event => setCode(event.target.value)}
          />
        </>
      ) : null}

      <Problem>{problem}</Problem>

      {stage === 'address' ? (
        <button className={`${ui.button} ${ui.primary} ${styles.submit}`} type="submit" disabled={request.isPending || email.trim() === ''}>
          {request.isPending ? t('recover.sending') : t('recover.send')}
        </button>
      ) : stage === 'code' ? (
        <button className={`${ui.button} ${ui.primary} ${styles.submit}`} type="submit" disabled={check.isPending || code.trim() === ''}>
          {t('recover.next')}
        </button>
      ) : (
        <button className={`${ui.button} ${ui.primary} ${styles.submit}`} type="button" onClick={() => setStage('code')}>
          {t('recover.enterCode')}
        </button>
      )}

      <p className={styles.links}>
        {stage === 'address' ? (
          <button type="button" className={styles.textLink} onClick={() => setStage('code')}>
            {t('recover.haveCode')}
          </button>
        ) : (
          <button type="button" className={styles.textLink} onClick={() => setStage('address')}>
            {t('recover.again')}
          </button>
        )}
      </p>
      <BackToSignIn />
    </Door>
  );
}

function NewPassword({ token }: { token: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const redeem = useRedeemReset();
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [refused, setSpent] = useState(false);
  // A link opened from the mail is asked first, as a typed code is: a spent or unknown one is said before a new
  // password has been thought of for it. A code checked a moment ago is not asked twice.
  const checked = (useLocation().state as { checked?: boolean } | null)?.checked === true;
  const valid = useResetValid(token, !checked);
  const spent = refused || refusalCode(valid.error) === 'reset_unknown';

  const submit = async () => {
    setProblem(null);
    try {
      await redeem.mutateAsync({ token, password });
      await navigate('/sign-in', { replace: true, state: { recovered: true } });
    } catch (error) {
      // A link used once, or older than its hour, is the one refusal a retry
      // cannot fix: it is said as that, with the way to a new one.
      if (refusalCode(error) === 'reset_unknown') setSpent(true);
      else setProblem(error instanceof ApiError ? (Object.values(error.fieldErrors)[0] ?? refusalText(error)) : refusalText(error));
    }
  };

  if (spent) {
    return (
      <Door title={t('recover.title')}>
        <Problem>{t('recover.spent')}</Problem>
        <Link to="/recover" className={`${ui.button} ${ui.primary} ${styles.submit}`}>
          {t('recover.askNew')}
        </Link>
        <BackToSignIn />
      </Door>
    );
  }

  return (
    <Door title={t('recover.newTitle')} onSubmit={() => void submit()}>
      <p className={styles.lead}>{t('recover.newIntro')}</p>
      <label className={`label ${styles.fieldLabel}`} htmlFor="new-password">
        {t('login.newPassword')}
      </label>
      <input
        id="new-password"
        className={ui.input}
        type="password"
        autoComplete="new-password"
        disabled={redeem.isPending}
        value={password}
        onChange={event => setPassword(event.target.value)}
      />
      <Problem>{problem}</Problem>
      <button className={`${ui.button} ${ui.primary} ${styles.submit}`} type="submit" disabled={redeem.isPending || password === ''}>
        {t('recover.set')}
      </button>
      <BackToSignIn />
    </Door>
  );
}
