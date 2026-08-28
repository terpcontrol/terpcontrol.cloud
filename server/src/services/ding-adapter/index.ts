import { Ding, DingArt, istGespeichert } from '@fg2/shared-types';
import { bildDinge } from './bild.adapter';
import { doseDinge } from './dose.adapter';
import { ereignisDinge } from './ereignis.adapter';
import { begrenze, DingAdapter, DingFenster } from './fenster';
import { filmDinge } from './film.adapter';
import { geraetDinge } from './geraet.adapter';
import { kameraDinge } from './kamera.adapter';
import { schemaDinge } from './schema.adapter';
import { zielDinge } from './ziel.adapter';
import { zeltDinge } from './zelt.adapter';

export type { DingAdapter, DingFenster } from './fenster';

/**
 * The nine arts nobody types, each read out of what already exists. They are
 * behind one signature on purpose: a caller asks for arts and a window and gets
 * Dinge, and cannot tell which of them Mongo stored and which of them a device,
 * an image or a socket table was read for.
 */
export const DING_ADAPTER: Readonly<Partial<Record<DingArt, DingAdapter>>> = Object.freeze({
  zelt: zeltDinge,
  geraet: geraetDinge,
  dose: doseDinge,
  kamera: kameraDinge,
  bild: bildDinge,
  film: filmDinge,
  ereignis: ereignisDinge,
  ziel: zielDinge,
  schema: schemaDinge,
});

/** The arts this module answers for. Everything else is stored and is the caller's business. */
export const PROJIZIERTE_ARTEN: DingArt[] = Object.keys(DING_ADAPTER) as DingArt[];

/** True for an art that is read out of something else rather than stored. */
export const istProjiziert = (art: string): boolean => art in DING_ADAPTER;

/**
 * Runs the projections for the requested arts over one window and returns them
 * as a single list, newest first. Arts that are stored are ignored rather than
 * refused: a caller passes the arts it was asked for, merges this list with
 * what it read from the `Ding` collection, and never has to know which side an
 * art falls on.
 *
 * With `arten` omitted, all nine run. With `geraete: []` six of them return
 * without a query.
 *
 * With `fenster.limit` set, every adapter reads at most one row more than the
 * page and the merge keeps that one row, so the list is longer than the page
 * exactly when a further page exists - that is the answer the caller pages on,
 * and the extra row is the one it drops after merging in the stored half.
 * Without a limit nothing is bounded, which is only ever right for an export.
 */
export const projiziereDinge = async (fenster: DingFenster, arten?: DingArt[]): Promise<Ding[]> => {
  const gefragt = (arten ?? PROJIZIERTE_ARTEN).filter(art => !istGespeichert(art));
  const listen = await Promise.all([...new Set(gefragt)].map(art => DING_ADAPTER[art]?.(fenster) ?? []));

  return begrenze(fenster, listen.flat());
};
