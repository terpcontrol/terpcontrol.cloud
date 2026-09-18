import { Outlet } from 'react-router';
import { Rail } from './Rail';
import { TabBar } from './TabBar';
import { TopBar } from './TopBar';
import styles from './AppShell.module.css';

/**
 * Phone first: a top bar, the screen, and the tab bar over the home indicator.
 * From the tablet breakpoint the same navigation is a left rail that also
 * carries the top bar's three things - one shell, two shapes, no second
 * component tree.
 */
export function AppShell() {
  return (
    <div className={styles.shell}>
      <Rail />
      <div className={styles.column}>
        <TopBar />
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
      <TabBar />
    </div>
  );
}
