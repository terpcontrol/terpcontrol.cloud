import { NavLink } from 'react-router';
import ui from './ui.module.css';
import styles from './Tabs.module.css';

export interface TabItem {
  key: string;
  label: string;
  to: string;
}

/**
 * The strip under a page header: a row of names, the active one underlined in
 * the brand colour. Each tab is an address, so a tab survives a reload and can
 * be linked to from elsewhere. `state` rides along from tab to tab, so what a
 * page was told about where it was opened from outlasts a change of tab.
 */
export function Tabs({ items, label, state }: { items: TabItem[]; label: string; state?: unknown }) {
  return (
    <nav className={`${ui.scrollRow} ${styles.tabs}`} aria-label={label} data-print="omit">
      {items.map(item => (
        <NavLink key={item.key} to={item.to} replace state={state} className={({ isActive }) => `${styles.tab} ${isActive ? styles.active : ''}`}>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
