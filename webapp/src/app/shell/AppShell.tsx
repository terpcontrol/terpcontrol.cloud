import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useMatches } from 'react-router';
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
 * carries what the top bar does - one shell, two shapes, no second component
 * tree.
 *
 * A page that is one task with one way on and one way out - adding a device,
 * editing a place, ending one - says so in its route (`handle: BARE`) and is
 * drawn without the bar: the page alone, in a phone's column. A bar of five
 * other places to go beside it is five ways to leave the task half done.
 *
 * Logging wraps both, because the sheet opens over whatever screen is showing
 * and what was written - a toast that says where a device now hangs - outlives
 * the page it was written from, the step out of a bare page included.
 */
export function AppShell() {
  const { t } = useTranslation();
  const main = useRef<HTMLElement>(null);
  const bare = useMatches().some(match => (match.handle as { bare?: boolean } | undefined)?.bare === true);
  usePageTitle(main);
  useFocusRescue();

  return (
    <LogProvider>
      {bare ? (
        <main className={styles.setup} ref={main} id="main" tabIndex={-1} data-bare>
          <Outlet />
        </main>
      ) : (
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
      )}
    </LogProvider>
  );
}
