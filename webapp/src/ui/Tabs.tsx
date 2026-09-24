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
 * be linked to from elsewhere.
 */
export function Tabs({ items, label }: { items: TabItem[]; label: string }) {
  return (
    <nav className={`${ui.scrollRow} ${styles.tabs}`} aria-label={label}>
      {items.map(item => (
        <NavLink key={item.key} to={item.to} replace className={({ isActive }) => `${styles.tab} ${isActive ? styles.active : ''}`}>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
