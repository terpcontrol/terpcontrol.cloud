import { ChartLine, House, Plus, SlidersHorizontal, Sprout, type LucideIcon } from 'lucide-react';
import { useLocation } from 'react-router';
import { useMayLogIn } from '@/ui/session-access';
import { useShape, type Shape } from './shape';

interface Tab {
  path: string;
  labelKey: string;
  Icon: LucideIcon;
  /** The Eintrag button, green wherever the navigation appears: it opens the sheet over the page and leads nowhere. */
  log?: boolean;
  /** The other addresses that are this item's pages, so it stays marked on them. */
  owns?: string[];
}

/** A place's own page and who is let into it are Start's, as the task list is, which Start's blocks open. */
const HOME: Tab = { path: '/', labelKey: 'shell.tabs.home', Icon: House, owns: ['/spaces', '/tasks'] };
const GROW: Tab = { path: '/grow', labelKey: 'shell.tabs.grow', Icon: Sprout, owns: ['/grows'] };
const LOG: Tab = { path: '/log', labelKey: 'shell.tabs.log', Icon: Plus, log: true };
const TIMELINE: Tab = { path: '/timeline', labelKey: 'shell.tabs.timeline', Icon: ChartLine, owns: ['/charts'] };
/** The devices are steered, added and set up under Steuerung; a camera's own page is a picture and marks nothing. */
const CONTROL: Tab = { path: '/control', labelKey: 'shell.tabs.control', Icon: SlidersHorizontal, owns: ['/devices', '/claim', '/cameras/add'] };

/**
 * Start · Grow · Eintrag · Verlauf · Steuerung, always in that order, each
 * there for what the account has and the session may do: Grow with the diary,
 * Eintrag with the diary and the right to write a line, Verlauf with a device,
 * Steuerung with a device the session may manage - so a guest who may only
 * log and the demo are offered none. One device and no diary is
 * Start · Verlauf · Steuerung; a diary without hardware is Start · Grow ·
 * Eintrag.
 */
export const tabsOf = (shape: Pick<Shape, 'diary' | 'steering' | 'managed'>, mayLog: boolean): Tab[] => [
  HOME,
  ...(shape.diary ? [GROW] : []),
  ...(shape.diary && mayLog ? [LOG] : []),
  ...(shape.steering ? [TIMELINE] : []),
  ...(shape.steering && shape.managed ? [CONTROL] : []),
];

export const useTabs = (): Tab[] => tabsOf(useShape(), useMayLogIn());

const under = (pathname: string, path: string): boolean => pathname === path || pathname.startsWith(`${path}/`);

/** Whether an item is the one the address is on: its own path, or one of the pages it owns. Meldungen, Ich and a camera mark none. */
export const useIsOn = (): ((tab: Tab) => boolean) => {
  const { pathname } = useLocation();

  return tab => (tab.path === '/' ? pathname === '/' : under(pathname, tab.path)) || (tab.owns ?? []).some(path => under(pathname, path));
};
