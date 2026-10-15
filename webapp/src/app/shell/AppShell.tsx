import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { LogProvider } from '@/log/LogProvider';
import { Rail } from './Rail';
import { TabBar } from './TabBar';
import { TopBar } from './TopBar';
import { LayoutNotice } from './LayoutNotice';
import { ZoneAdoption } from './ZoneAdoption';
import { useFocusRescue } from '@/ui/focus-rescue';
import { usePageTitle } from './page-title';
import styles from './AppShell.module.css';

/**
 * Phone first: a top bar, the screen, and the tab bar over the home indicator.
 * From the tablet breakpoint the same navigation is a left rail that also
 * carries the top bar's three things - one shell, two shapes, no second
 * component tree.
 *
 * Logging wraps all of it, because the sheet opens over whatever screen is
 * showing and what it wrote outlives the screen it was written from.
 */
export function AppShell() {
  const { t } = useTranslation();
  const main = useRef<HTMLElement>(null);
  usePageTitle(main);
  useFocusRescue();

  return (
    <LogProvider>
      <div className={styles.shell}>
        {/* The first stop of a keyboard and a screen reader, past the navigation that comes before the page on every page. */}
        <a href="#main" className={styles.skip}>
          {t('shell.skipToContent')}
        </a>
        <Rail />
        <div className={styles.column}>
          <TopBar />
          <main className={styles.main} ref={main} id="main" tabIndex={-1}>
            <ZoneAdoption />
            <LayoutNotice />
            <Outlet />
          </main>
        </div>
        <TabBar />
      </div>
    </LogProvider>
  );
}
