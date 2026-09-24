import { Outlet } from 'react-router';
import { LogProvider } from '@/log/LogProvider';
import { Rail } from './Rail';
import { TabBar } from './TabBar';
import { TopBar } from './TopBar';
import { ZoneAdoption } from './ZoneAdoption';
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
  return (
    <LogProvider>
      <div className={styles.shell}>
        <Rail />
        <div className={styles.column}>
          <TopBar />
          <main className={styles.main}>
            <ZoneAdoption />
            <Outlet />
          </main>
        </div>
        <TabBar />
      </div>
    </LogProvider>
  );
}
