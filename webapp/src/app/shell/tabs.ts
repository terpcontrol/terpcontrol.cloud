import { ChartLine, Cpu, House, Plus, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { useLocation } from 'react-router';
import { useMayLog } from '@/log/log-context';
import { useShape, type Shape } from './shape';

export interface Tab {
  path: string;
  labelKey: string;
  Icon: LucideIcon;
  /** The Log button, drawn raised and green wherever the navigation appears. */
  raised?: boolean;
  /** The other addresses that are this tab's pages, so it stays marked on them. */
  owns?: string[];
}

/** A grow and the task list are opened from a cockpit's grow block, so they are Start's pages as a place is. */
const HOME: Tab = { path: '/', labelKey: 'shell.tabs.home', Icon: House, owns: ['/spaces/', '/grows/', '/tasks'] };
const TIMELINE: Tab = { path: '/timeline', labelKey: 'shell.tabs.timeline', Icon: ChartLine, owns: ['/charts'] };
const LOG: Tab = { path: '/log', labelKey: 'shell.tabs.log', Icon: Plus, raised: true };
const CONTROL: Tab = { path: '/control', labelKey: 'shell.tabs.control', Icon: SlidersHorizontal };
const DEVICES: Tab = { path: '/devices', labelKey: 'shell.tabs.devices', Icon: Cpu, owns: ['/cameras/', '/claim'] };

/**
 * Start · Verlauf · Steuerung · Gerät, the same four for every account: what
 * is it doing, what did it do, what should it do, and the hardware. "Gerät"
 * becomes "Geräte" once there is more than one thing to list there.
 *
 * The diary brings the Log button back into the middle, green and raised -
 * and only the diary, so somebody who keeps none is not offered a button for
 * writing one. Its tasks are reached from the grow block and the bell rather
 * than a tab of their own. A session that may not write is never offered it.
 */
export const tabsOf = (shape: Pick<Shape, 'diary' | 'devices'>, mayLog: boolean): Tab[] => [
  HOME,
  TIMELINE,
  ...(shape.diary && mayLog ? [LOG] : []),
  CONTROL,
  shape.devices > 1 ? DEVICES : { ...DEVICES, labelKey: 'shell.tabs.device' },
];

export const useTabs = (): Tab[] => tabsOf(useShape(), useMayLog());

/** Whether a tab is the one the address is on: its own path, or one of the pages it owns. */
export const useIsOn = (): ((tab: Tab) => boolean) => {
  const { pathname } = useLocation();

  return tab =>
    (tab.path === '/' ? pathname === '/' : pathname === tab.path || pathname.startsWith(`${tab.path}/`)) ||
    (tab.owns ?? []).some(prefix => pathname.startsWith(prefix));
};

/** Two letters of the handle, which is the only name anyone is shown. */
export const initials = (handle: string): string => handle.slice(0, 2).toUpperCase();
