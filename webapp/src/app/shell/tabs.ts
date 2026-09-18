import { ChartLine, CircleCheck, Cpu, House, Plus, type LucideIcon } from 'lucide-react';

export interface Tab {
  path: string;
  labelKey: string;
  Icon: LucideIcon;
  /** The Log button, drawn raised and green wherever the navigation appears. */
  raised?: boolean;
}

/** Home · Timeline · Log (raised) · Devices · Tasks, in that order, on the bar and on the rail. */
export const TABS: Tab[] = [
  { path: '/', labelKey: 'shell.tabs.home', Icon: House },
  { path: '/timeline', labelKey: 'shell.tabs.timeline', Icon: ChartLine },
  { path: '/log', labelKey: 'shell.tabs.log', Icon: Plus, raised: true },
  { path: '/devices', labelKey: 'shell.tabs.devices', Icon: Cpu },
  { path: '/tasks', labelKey: 'shell.tabs.tasks', Icon: CircleCheck },
];

/** Two letters of the handle, which is the only name anyone is shown. */
export const initials = (handle: string): string => handle.slice(0, 2).toUpperCase();
