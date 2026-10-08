import { ChartLine, Cpu, House, Plus, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { useLocation } from 'react-router';
import { FROM_PLACE, openedFrom } from '@/app/places';
import { useMayLogIn } from '@/ui/session-access';
import { useShape, type Shape } from './shape';

interface Tab {
  path: string;
  labelKey: string;
  Icon: LucideIcon;
  /** The Log button, drawn raised and green wherever the navigation appears. */
  raised?: boolean;
  /** The other addresses that are this tab's pages, so it stays marked on them. */
  owns?: string[];
}

/** A grow, the list of every grow and the task list are reached from Start, so they are Start's pages as a place is. */
const HOME: Tab = { path: '/', labelKey: 'shell.tabs.home', Icon: House, owns: ['/spaces/', '/grows', '/tasks'] };
const TIMELINE: Tab = { path: '/timeline', labelKey: 'shell.tabs.timeline', Icon: ChartLine, owns: ['/charts'] };
const LOG: Tab = { path: '/log', labelKey: 'shell.tabs.log', Icon: Plus, raised: true };
const CONTROL: Tab = { path: '/control', labelKey: 'shell.tabs.control', Icon: SlidersHorizontal };
const DEVICES: Tab = { path: '/devices', labelKey: 'shell.tabs.devices', Icon: Cpu, owns: ['/cameras/', '/claim'] };

/**
 * Start · Verlauf · Steuerung · Gerät: what is it doing, what did it do, what
 * should it do, and the hardware. "Gerät" becomes "Geräte" once there is more
 * than one thing to list there.
 *
 * Steuerung is there once there is a device to steer, and Gerät once there is
 * anything to list. Somebody who keeps a diary without hardware was shown two
 * tabs that said only that nothing stood there: the diary is their app, and
 * hardware is offered under the grow and under Ich instead. A camera alone is
 * listed under Gerät and steers nothing.
 *
 * The diary brings the Log button back into the middle, green and raised -
 * and only the diary, so somebody who keeps none is not offered a button for
 * writing one. Its tasks are reached from the grow block and the bell rather
 * than a tab of their own. A session that may not write is never offered it.
 */
export const tabsOf = (shape: Pick<Shape, 'diary' | 'devices'> & Partial<Pick<Shape, 'steering'>>, mayLog: boolean): Tab[] => {
  const others = [
    HOME,
    TIMELINE,
    ...(shape.steering === false ? [] : [CONTROL]),
    ...(shape.steering === false && shape.devices === 0 ? [] : [shape.devices > 1 ? DEVICES : { ...DEVICES, labelKey: 'shell.tabs.device' }]),
  ];
  if (!shape.diary || !mayLog) return others;

  // In the middle of however many there are: with only Start and Verlauf beside it, between them.
  const middle = Math.ceil(others.length / 2);
  return [...others.slice(0, middle), LOG, ...others.slice(middle)];
};

export const useTabs = (): Tab[] => tabsOf(useShape(), useMayLogIn());

/**
 * Whether a tab is the one the address is on: its own path, or one of the pages
 * it owns. A camera opened from a place's picture is that place's, so Start
 * stays marked on it rather than the bar jumping to Gerät.
 */
export const useIsOn = (): ((tab: Tab) => boolean) => {
  const { pathname, state } = useLocation();
  const fromPlace = pathname.startsWith('/cameras/') && openedFrom(state, FROM_PLACE);

  return tab => {
    if (fromPlace) return tab.path === '/';
    return (
      (tab.path === '/' ? pathname === '/' : pathname === tab.path || pathname.startsWith(`${tab.path}/`)) ||
      (tab.owns ?? []).some(prefix => pathname.startsWith(prefix))
    );
  };
};
