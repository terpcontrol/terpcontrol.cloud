import { Moon, Sun } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useTheme } from '@/theme/theme-context';
import { Logo } from '@/ui/Logo';
import styles from './Public.module.css';

/**
 * The chrome a page wears when nobody is signed in: the logo, the light and
 * dark switch, and a line at the foot saying what this is.
 *
 * Deliberately not the app shell. The tab bar, the rail and the top bar are
 * about an account - the bell, the avatar, the raised Log button - and every
 * one of them would lead a stranger to the sign-in page. What is here instead
 * is what a reader who has never seen the product needs: the diary, who keeps
 * it, and one way in if they want one.
 */
export function PublicShell({ title, children }: { title?: string; children: ReactNode }) {
  const { t } = useTranslation();

  // The tab is part of the page for somebody who opened three links at once.
  useEffect(() => {
    const before = document.title;
    document.title = title ? `${title} · Terp Control` : 'Terp Control';
    return () => {
      document.title = before;
    };
  }, [title]);

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <span className={styles.wordmark}>
          <Logo />
        </span>
        <ThemeSwitch />
      </header>

      <main className={styles.column}>{children}</main>

      <footer className={styles.foot}>
        <p className={styles.footLine}>{t('publicPage.footer')}</p>
        <Link to="/" className={styles.footLink}>
          {t('publicPage.openApp')}
        </Link>
      </footer>
    </div>
  );
}

/**
 * One button rather than the three the account page offers. A reader who landed
 * here from a message wants the page to stop glaring at them, not a preference;
 * the choice is stored the same way and the account page still has all three.
 */
function ThemeSwitch() {
  const { t } = useTranslation();
  const { choice, setChoice } = useTheme();
  const dark = choice === 'dark' || (choice === 'system' && prefersDark());

  return (
    <button
      type="button"
      className={styles.themeSwitch}
      onClick={() => setChoice(dark ? 'light' : 'dark')}
      aria-label={t(dark ? 'publicPage.toLight' : 'publicPage.toDark')}
    >
      {dark ? <Sun size={18} strokeWidth={1.75} aria-hidden /> : <Moon size={18} strokeWidth={1.75} aria-hidden />}
    </button>
  );
}

/** A browser without `matchMedia` - a test's - is answered light, which is the token file's default. */
const prefersDark = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
