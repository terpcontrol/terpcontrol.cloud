import { Ding } from '@fg2/shared-types';
import { DingFenster, ueberschneidet } from './fenster';

/**
 * The tent itself, as a row. It begins at `tag_null` and never ends, so it is
 * in every window that reaches day one - including a window that opened long
 * after the grow started.
 *
 * The sensor half of a tent is not here. Measurements are a series and are read
 * as a series (§10.1); folding today's temperature into this Ding would make
 * the row mean something different for a tent with a device than without one.
 */
export const zeltDinge = async (fenster: DingFenster): Promise<Ding[]> => {
  const zelt = fenster.zelt;
  if (!ueberschneidet(fenster, zelt.tag_null, null)) {
    return [];
  }

  return [
    {
      ding_id: `zelt:${zelt.zelt_id}`,
      zelt_id: zelt.zelt_id,
      art: 'zelt',
      // Empty until somebody names the tent - the server has no locale and must
      // not invent a name in a language it cannot know.
      name: zelt.name ?? '',
      t: zelt.tag_null,
      t_ende: null,
      erfasst_at: zelt.erstellt_at,
      d: { zeitzone: zelt.zeitzone, medium: zelt.d?.medium },
    },
  ];
};
