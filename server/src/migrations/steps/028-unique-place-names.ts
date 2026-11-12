import { nameKey, numbered } from '@common/v1/space-names';
import { MigrationContext, MigrationStep } from '../migration';

interface NamedSpace {
  id: string;
  ownerId: string;
  kind: string;
  name: string;
}

/**
 * Renames the places, and the rooms, of one account that share a name.
 *
 * A name is unique per owner now - among the places that have not ended, and
 * among the rooms that have not - and the server refuses a second one. Nothing
 * refused it before, and a place made for a claimed device took the device's
 * name, so two modules both called "Fridge" left two places called "Fridge".
 *
 * The oldest of a name keeps it, because it is the one people have known
 * longest by it; each later one takes the next number that is free among the
 * owner's names ("Fridge 2"), compared as the server compares them. A place
 * that has ended is not renamed and takes no part: its name is free again.
 *
 * After a run no two share a name, so a second run finds nothing.
 */
export const uniquePlaceNames: MigrationStep = {
  name: '028-unique-place-names',

  async run(context: MigrationContext): Promise<void> {
    const spaces = context.db.collection<NamedSpace>('spaces');
    const live = await spaces
      .find({ archivedAt: null }, { projection: { id: 1, ownerId: 1, kind: 1, name: 1 } })
      .sort({ createdAt: 1, id: 1 })
      .toArray();

    // Per owner, the places among themselves and the rooms among themselves.
    const groups = new Map<string, NamedSpace[]>();
    for (const space of live) {
      const group = `${space.ownerId} ${space.kind === 'room' ? 'room' : 'place'}`;
      groups.set(group, [...(groups.get(group) ?? []), space]);
    }

    for (const [group, peers] of groups) {
      const taken = new Set(peers.map(peer => nameKey(peer.name)));
      const seen = new Set<string>();

      for (const space of peers) {
        const key = nameKey(space.name);
        if (!seen.has(key)) {
          seen.add(key);
          continue;
        }

        const name = numbered(space.name.trim(), taken);
        taken.add(nameKey(name));
        seen.add(nameKey(name));
        context.count(group.endsWith('room') ? 'rooms.renamed' : 'spaces.renamed');
        if (!context.dryRun) await spaces.updateOne({ id: space.id }, { $set: { name } });
      }
    }
  },
};
