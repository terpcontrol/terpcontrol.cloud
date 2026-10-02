import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useRedeemReset, useRequestReset } from '@/api/account';
import { ApiError } from '@/api/problem';
import { Logo } from '@/ui/Logo';
import { refusalText } from '@/ui/refusal';
import ui from '@/ui/ui.module.css';
import styles from './SignIn.module.css';

/**
 * A forgotten password, outside the shell like the sign-in it leads back to.
 *
 * Without a token it asks for the address and says a mail is on its way -
 * whether or not the address has an account here, because the server answers
 * both the same and so must the page. The mail carries a link to this page with
 * its token, and the same token as a code for somebody who reads it on another
 * device: "Enter the code" takes it typed and goes on as the link would. With a
 * token it asks for the new password and, once it is set, sends the person to
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

  return (
    <Door onSubmit={() => (stage === 'code' ? void navigate(`/recover/${encodeURIComponent(code.trim())}`) : void send())} title={t('recover.title')}>
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
            className={`mono ${ui.input}`}
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            value={code}
            onChange={event => setCode(event.target.value)}
          />
        </>
      ) : null}

      {problem ? (
        <p className={`${ui.problem} ${styles.problem}`} role="alert">
          {problem}
        </p>
      ) : null}

      {stage === 'address' ? (
        <button className={`${ui.button} ${ui.primary} ${styles.submit}`} type="submit" disabled={request.isPending || email.trim() === ''}>
          {request.isPending ? t('recover.sending') : t('recover.send')}
        </button>
      ) : stage === 'code' ? (
        <button className={`${ui.button} ${ui.primary} ${styles.submit}`} type="submit" disabled={code.trim() === ''}>
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
      <p className={styles.links}>
        <Link to="/sign-in">{t('login.backToLogin')}</Link>
      </p>
    </Door>
  );
}

function NewPassword({ token }: { token: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const redeem = useRedeemReset();
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [spent, setSpent] = useState(false);

  const submit = async () => {
    setProblem(null);
    try {
      await redeem.mutateAsync({ token, password });
      await navigate('/sign-in', { replace: true, state: { recovered: true } });
    } catch (error) {
      // A link used once, or older than its hour, is the one refusal a retry
      // cannot fix: it is said as that, with the way to a new one.
      if (error instanceof ApiError && error.problem.code === 'reset_unknown') setSpent(true);
      else setProblem(error instanceof ApiError ? (Object.values(error.fieldErrors)[0] ?? refusalText(error)) : refusalText(error));
    }
  };

  if (spent) {
    return (
      <Door title={t('recover.title')}>
        <p className={`${ui.problem} ${styles.problem}`} role="alert">
          {t('recover.spent')}
        </p>
        <Link to="/recover" className={`${ui.button} ${ui.primary} ${styles.submit}`}>
          {t('recover.askNew')}
        </Link>
        <p className={styles.links}>
          <Link to="/sign-in">{t('login.backToLogin')}</Link>
        </p>
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
      {problem ? (
        <p className={`${ui.problem} ${styles.problem}`} role="alert">
          {problem}
        </p>
      ) : null}
      <button className={`${ui.button} ${ui.primary} ${styles.submit}`} type="submit" disabled={redeem.isPending || password === ''}>
        {t('recover.set')}
      </button>
      <p className={styles.links}>
        <Link to="/sign-in">{t('login.backToLogin')}</Link>
      </p>
    </Door>
  );
}

/** The card every page outside the shell stands in: the logo, a step's title, and the form. */
export function Door({ title, onSubmit, children }: { title: string; onSubmit?: () => void; children: React.ReactNode }) {
  return (
    <main className={styles.page}>
      <form
        className={styles.card}
        noValidate
        onSubmit={event => {
          event.preventDefault();
          onSubmit?.();
        }}
      >
        <h1 className={styles.wordmark}>
          <Logo />
        </h1>
        <h2 className={styles.step}>{title}</h2>
        {children}
      </form>
    </main>
  );
}
