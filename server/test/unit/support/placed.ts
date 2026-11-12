/**
 * Where a device row of a spec stands: the place, and the placement that says
 * since when. A read about the past asks the placement, so a device a spec
 * puts in a tent has stood there for as long as the spec cares to look back
 * unless it says otherwise.
 */
export const standingIn = (
  spaceId: string,
  since: Date = new Date(0),
): { spaceId: string; placements: { spaceId: string; startedAt: Date; endedAt: Date | null }[] } => ({
  spaceId,
  placements: [{ spaceId, startedAt: since, endedAt: null }],
});
