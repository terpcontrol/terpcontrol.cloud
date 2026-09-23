import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import type { SessionCreate } from '@fg2/shared-types/v1';
import { CUSTOM_LINKS_HTML } from '@/api/config';
import { ApiError } from '@/api/problem';
import { session, useSession } from '@/api/session';
import ui from '@/ui/ui.module.css';
import styles from './SignIn.module.css';

/**
 * The one screen outside the shell, and the pattern for every form after it:
 * the body is a type from the contract, the form checks only what keeps a
 * pointless request from being sent, and what is actually valid is the server's
 * answer - its `errors[]` come back keyed by the field they belong to.
 *
 * A phone is where the app lives, so a session stays until it is signed out.
 *
 * What a refusal is reported as is `refusalOf` below: the stock "check your
 * e-mail and password" is only ever said where it is true, because it would
 * otherwise send somebody to retype a password that was right.
 */
export function SignIn() {
  const { t } = useTranslation();
  const { user } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [problem, setProblem] = useState<string | null>(null);
  const [openingDemo, setOpeningDemo] = useState(false);

  const form = useForm<SessionCreate>({ defaultValues: { email: '', password: '', stayLoggedIn: true } });
  const destination = (location.state as { from?: string } | null)?.from ?? '/';

  if (user) return <Navigate to={destination} replace />;

  const submit = form.handleSubmit(async credentials => {
    setProblem(null);
    try {
      await session.logIn(credentials);
      await navigate(destination, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [field, detail] of Object.entries(error.fieldErrors)) form.setError(field as keyof SessionCreate, { message: detail });
      }
      setProblem(refusalOf(error, t));
    }
  });

  const openDemo = async () => {
    setProblem(null);
    setOpeningDemo(true);
    try {
      await session.openDemo();
      await navigate('/', { replace: true });
    } catch {
      setProblem(t('login.demoFailed'));
      setOpeningDemo(false);
    }
  };

  const busy = form.formState.isSubmitting || openingDemo;

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={submit} noValidate>
        <h1 className={styles.wordmark}>Terp Control</h1>

        <label className={`label ${styles.fieldLabel}`} htmlFor="email">
          {t('login.email')}
        </label>
        <input
          id="email"
          className={ui.input}
          type="email"
          autoComplete="username"
          inputMode="email"
          disabled={busy}
          {...form.register('email', { required: true })}
        />

        <label className={`label ${styles.fieldLabel}`} htmlFor="password">
          {t('login.password')}
        </label>
        <input
          id="password"
          className={ui.input}
          type="password"
          autoComplete="current-password"
          disabled={busy}
          {...form.register('password', { required: true })}
        />

        {problem ? (
          <p className={`${ui.problem} ${styles.problem}`} role="alert">
            {problem}
          </p>
        ) : null}

        <button className={`${ui.button} ${ui.primary} ${styles.submit}`} type="submit" disabled={busy}>
          {t('login.signIn')}
        </button>

        <button className={`${ui.button} ${styles.demo}`} type="button" onClick={openDemo} disabled={busy}>
          {openingDemo ? t('demo.opening') : t('login.demo')}
        </button>

        <p className={styles.links}>
          {t('login.noAccount')}{' '}
          <Link to="/sign-up" state={{ from: destination }}>
            {t('login.createAccount')}
          </Link>
        </p>

        {CUSTOM_LINKS_HTML ? <div className={styles.links} dangerouslySetInnerHTML={{ __html: CUSTOM_LINKS_HTML }} /> : null}
      </form>
    </main>
  );
}

/**
 * What the card says when the sign-in was refused.
 *
 * The stock sentence names the two fields, which is the truth for the refusal
 * that is about them and a lie for the ones that are not. Two are not. An
 * account still waiting for its activation is refused in the server's own
 * words, which name the address the code went to and say more than this screen
 * could without them. And the server counts sign-in attempts per address and
 * refuses the eleventh within a minute with 429 whoever it came from, so a
 * household, an office or a phone on a carrier's shared address can be turned
 * away while the password in the field is correct - and telling that person to
 * check their password sends them to change one that was never the problem.
 * The wait is said in the app's own words rather than the server's, because
 * the server phrases its details in English alone and the card around them is
 * in the grower's language.
 *
 * Everything else keeps the stock sentence: the wrong password itself, which
 * is deliberately not told apart from an address that has no account here, and
 * a server or a connection that failed, whose own words are written for
 * whoever runs the install rather than for whoever is standing at the form.
 */
const refusalOf = (error: unknown, t: TFunction): string => {
  if (!(error instanceof ApiError)) return t('shell.signInFailed');
  if (error.problem.code === 'account_not_activated') return error.problem.detail || error.problem.title;

  return error.status === 429 ? t('shell.signInTooMany') : t('shell.signInFailed');
};
