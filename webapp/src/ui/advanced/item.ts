import type { ComponentType } from 'react';
import type { Device, SocketPage } from '@fg2/shared-types/v1';

/**
 * The items an Erweitert section offers, wherever one stands: per device on
 * its page. Erweitert is where what most growers
 * never need goes, one collapsed section beside the thing it is about; a
 * section with nothing to offer is not drawn at all.
 *
 * An item is one file anywhere under `src/` whose name ends in `.advanced.tsx`
 * and that exports `items`, built with `advancedItem`: the registry
 * (`registry.ts`) finds it at build time, so adding one touches no file but its
 * own (and the catalogues). Its help topics are named `advanced.<name>` and
 * live under `help.advanced` in both catalogues.
 */

/** What an item about one device is drawn with. */
export interface DeviceContext {
  device: Device;
  /** Whether the person may change the device; an item that only changes things draws nothing without it. */
  mayManage: boolean;
  /** Gone quiet: a change is stored and sent, and the device takes it when it is back. */
  offline: boolean;
  /** Whether the person may give the device up, which is the owner's alone. Left out, they may not. */
  mayOwn?: boolean;
  /** Whether the person runs this install, which some of what is here is for. Left out, they do not. */
  isAdmin?: boolean;
  /** The device's smart sockets as it last reported them, once read; left out for a device that drives none. */
  sockets?: SocketPage;
}

export interface AdvancedContexts {
  device: DeviceContext;
}

export type AdvancedScope = keyof AdvancedContexts;

export interface ItemOf<S extends AdvancedScope> {
  scope: S;
  /** Unique across the app; the React key. */
  id: string;
  /** Where it stands among the items of its section, smallest first. */
  order: number;
  /** Whether it is offered here at all. Only what exists is shown: a fridge's work mode is not a light's. */
  shows: (context: AdvancedContexts[S]) => boolean;
  Item: ComponentType<AdvancedContexts[S]>;
}

export type AdvancedItem = { [S in AdvancedScope]: ItemOf<S> }[AdvancedScope];

/** Typed for its scope, so `shows` and `Item` are handed the context that scope draws with. */
export const advancedItem = <S extends AdvancedScope>(item: ItemOf<S>): ItemOf<S> => item;
