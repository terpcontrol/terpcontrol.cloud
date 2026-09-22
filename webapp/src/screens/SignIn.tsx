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
 * An account that is not yet activated is refused with a sentence that says
 * so, and that sentence is shown as it came: the stock "check your e-mail and
 * password" would send somebody to retype a password that was right.
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
      const notActivated = error instanceof ApiError && error.problem.code === 'account_not_activated';
      setProblem(notActivated ? error.problem.detail || error.problem.title : t('shell.signInFailed'));
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
