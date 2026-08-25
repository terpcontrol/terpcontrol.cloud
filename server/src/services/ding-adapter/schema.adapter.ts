import { Ding } from '@fg2/shared-types';
import { begrenze, DingFenster, ueberschneidet } from './fenster';

/**
 * The feed schedule the tent follows, and how far along it is.
 *
 * The catalogue itself - the `Schema` collection with its steps, products and
 * EC targets - arrives in a later slice. Until it does there is nothing to join
 * to, so this projects what the Zelt itself knows: which schema, which step. A
 * caller finds no label here and must not invent one.
 *
 * It projects with no device, and device-less it is the only forward-looking
 * statement the product makes.
 */
export const schemaDinge = async (fenster: DingFenster): Promise<Ding[]> => {
  const zelt = fenster.zelt;
  const schema_id = zelt.d?.schema_id;
  if (!schema_id || !ueberschneidet(fenster, zelt.tag_null, null)) {
    return [];
  }

  return begrenze(fenster, [
    {
      ding_id: `schema:${zelt.zelt_id}:${schema_id}`,
      zelt_id: zelt.zelt_id,
      art: 'schema',
      // The label lives in the catalogue, in the reader's language. The id is
      // not a name and is not printed as one.
      name: '',
      // Nothing records when the schema was chosen - it is picked on the create
      // sheet and applies to the grow - so it starts where the grow starts.
      t: zelt.tag_null,
      t_ende: null,
      d: { schema_id: schema_id, schritt: zelt.d?.schema_schritt },
    },
  ]);
};
