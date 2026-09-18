import { z } from 'zod';
import {
  anyValue,
  growOrSpaceRef,
  growthStage,
  growType,
  id,
  instant,
  memberRole,
  named,
  page,
  reminderKind,
  schemeWeek,
  spaceKind,
} from './common.js';

/**
 * Places, people and grows: `spaces`, `memberships`, `invites`, `grows`,
 * `plants`, `follows` and `reminders`, the value objects they are built from,
 * and the shapes the API derives from them.
 *
 * A grow is the whole story of a set of plants: where they stand, what stage
 * they are in and what they are fed. None of that lives on a device - a grow
 * exists without one, and a device without a grow.
 */

/** Whether applying a climate preset to this space offers to set a grow's phase. */
export const presetPrompt = named('PresetPrompt', z.enum(['ask', 'never']));

export const spaceRetention = named(
  'SpaceRetention',
  z.object({
    climateDays: z.number().int().positive().nullable().describe('How long raw climate points are kept; null is the install default.'),
  }),
);

export const space = named(
  'Space',
  z.object({
    id: id(),
    ownerId: id(),
    kind: spaceKind,
    name: z.string(),
    roomId: id().nullable().describe('A space of kind `room`, one level deep. Null is a space that stands on its own.'),
    presetPrompt,
    retention: spaceRetention,
    isDemo: z.boolean(),
    archivedAt: instant().nullable().describe('A tombstone: history still names the space, so it is kept and no longer listed.'),
    createdAt: instant(),
  }),
);

/**
 * One row per person who is not the owner. The owner is `spaces.ownerId` and
 * never a row here, so there is no `owner` role; a membership on a room covers
 * every space in it.
 */
export const membership = named(
  'Membership',
  z.object({
    id: id(),
    spaceId: id(),
    userId: id(),
    role: memberRole,
    invitedBy: id().nullable(),
    inviteId: id().nullable().describe('The invite that was redeemed, or null for a member added by hand.'),
    createdAt: instant(),
  }),
);

/** Maintained by the server: what the link has done since it was made. */
export const inviteState = named(
  'InviteState',
  z.object({
    useCount: z.number().int(),
    lastUsedAt: instant().nullable(),
  }),
);

/**
 * One code serves the link, the typed code and the QR, so it is short enough to
 * read aloud. It is also the whole proof of the invitation, so it is answered
 * only to whoever may manage the space - a redemption is addressed by the code
 * itself and is told nothing about it.
 */
export const invite = named(
  'Invite',
  z.object({
    id: id(),
    code: z.string().describe('8 characters from the claim-code alphabet; unique.'),
    spaceId: id(),
    role: memberRole,
    createdBy: id(),
    expiresAt: instant().nullable(),
    revokedAt: instant().nullable(),
    state: inviteState,
    createdAt: instant(),
  }),
);

/** Who put the grow into this phase. `preset` and `plan` are what the "auto" tag is drawn from. */
export const phaseSource = named('PhaseSource', z.enum(['preset', 'plan', 'human']));

/** Day and night, as the controller's configuration states them. */
export const climateTargets = named(
  'ClimateTargets',
  z.object({
    temperature: z.number().nullable(),
    humidity: z.number().nullable(),
  }),
);

export const phaseTargets = named(
  'PhaseTargets',
  z.object({
    day: climateTargets,
    night: climateTargets,
    co2: z.number().nullable().describe('One target: the controller only raises CO2 while the light is on.'),
  }),
);

/**
 * `stage` is the botanical fact and crosses the device protocol; `preset` is the
 * climate preset that was applied and is only a label. "Late flower" is
 * `flowering` with the preset `late_flowering`, which is how the screens draw a
 * seventh step without inventing a seventh stage. A preset table ships with the
 * client and may grow without the wire contract changing, so `preset` is a
 * string rather than an enum.
 */
export const phase = named(
  'Phase',
  z.object({
    id: id(),
    stage: growthStage,
    preset: z.string().nullable(),
    startedAt: instant(),
    source: phaseSource,
    plantIds: z.array(id()).nullable().describe('Null is every plant of the grow; a list is the scope of a split.'),
    deviceId: id().nullable().describe('The controller the targets were read from, if any.'),
    targets: phaseTargets.nullable().describe('A snapshot: Influx stores sensors and outputs, never setpoints, so a past phase has no other way to draw its target band.'),
    setBy: id().nullable().describe('The user, or null when a plan or a preset wrote the phase.'),
  }),
);

/** Where a set of plants stands, for a stretch of time. Overlapping placements are how a grow is in two places at once. */
export const placement = named(
  'Placement',
  z.object({
    id: id(),
    spaceId: id().nullable().describe('Null is "no fixed place".'),
    startedAt: instant(),
    endedAt: instant().nullable().describe('Null is open: this is where the plants are now.'),
    plantIds: z.array(id()).nullable().describe('Null is every plant of the grow.'),
  }),
);

/**
 * Where the grid came from. A shipped scheme is a JSON asset of the client, so
 * the server knows only which asset and which version; `own` points at the
 * user's own scheme, whose own origin is `SchemeOrigin`.
 */
export const growSchemeOrigin = named(
  'GrowSchemeOrigin',
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('asset'),
      assetId: z.string(),
      version: z.string().describe('The asset version the grid was taken from, so an edited asset never rewrites a past grow.'),
    }),
    z.object({
      type: z.literal('own'),
      schemeId: id(),
    }),
  ]),
);

/**
 * The effective feeding grid of this grow. The server never reads a shipped
 * scheme, so the grow carries the grid itself: that is also what keeps a grow's
 * history stable when the scheme it came from is edited later.
 */
export const growScheme = named(
  'GrowScheme',
  z.object({
    origin: growSchemeOrigin,
    strength: z.number().describe('Multiplier on the printed amounts; 1 is the scheme as published.'),
    waterEc: z.number().nullable().describe("The tap water's own EC, which the scheme's figures are read on top of."),
    plantType: z.string().describe("The scheme's own selector, such as its medium or plant type; the server does not interpret it."),
    flipWeek: z.number().int().nullable().describe('The week the light is flipped; null for an autoflower.'),
    edited: z.boolean().describe('The grid was changed by hand and no longer matches its origin.'),
    grid: z.array(schemeWeek),
  }),
);

/** What this grow measures beyond climate. `entries.values.readings` is keyed by `key`. */
export const measurementDefinition = named(
  'MeasurementDefinition',
  z.object({
    key: z.string(),
    name: z.string(),
    unit: z.string(),
    perPlant: z.boolean().describe('A reading is taken per plant rather than for the grow.'),
    target: z.number().nullable(),
    chart: z.boolean().describe('Drawn as a series beside the climate charts.'),
  }),
);

export const growVisibility = named('GrowVisibility', z.enum(['private', 'public']));

export const grow = named(
  'Grow',
  z.object({
    id: id(),
    ownerId: id(),
    name: z.string(),
    description: z.string().nullable(),
    type: growType,
    phases: z.array(phase).describe('Ordered by `startedAt`. The single truth for the day counter, the phase and the "auto" tag.'),
    placements: z.array(placement),
    scheme: growScheme.nullable(),
    measurements: z.array(measurementDefinition),
    visibility: growVisibility,
    slug: z.string().describe('Unique and stable, assigned at creation, so making a grow public never changes its address.'),
    coverMediaId: id().nullable(),
    filmMediaId: id().nullable().describe('The whole-grow timelapse, once it has been rendered.'),
    startedAt: instant(),
    endedAt: instant().nullable(),
    isDemo: z.boolean(),
    createdAt: instant(),
    updatedAt: instant(),
  }),
);

export const plantStatus = named('PlantStatus', z.enum(['active', 'harvested', 'ended']));

/** Weights are stripped from every view but the owner's and a member's. */
export const plantHarvest = named(
  'PlantHarvest',
  z.object({
    harvestedAt: instant(),
    wetWeightG: z.number().nullable(),
    dryWeightG: z.number().nullable(),
  }),
);

/**
 * A plant is a document of its own, so a phase, a placement or a harvest can
 * name exactly these plants and a count is simply how many rows there are.
 */
export const plant = named(
  'Plant',
  z.object({
    id: id(),
    growId: id(),
    strain: z.string(),
    label: z.string().describe('What the plant is called on a card, such as "Amnesia 3".'),
    status: plantStatus,
    harvest: plantHarvest.nullable(),
    createdAt: instant(),
  }),
);

/**
 * One person following one grow. `PUT /follows/{growId}` and its `DELETE` carry
 * no body - the grow is in the path and a follow has nothing else to say - and
 * the `PUT` answers this. What the home screen draws for a followed grow is a
 * read model of the diary half rather than a fatter follow, because a follower
 * sees a public grow and only what its public page shows.
 */
export const follow = named(
  'Follow',
  z.object({
    id: id(),
    userId: id(),
    growId: id(),
    createdAt: instant(),
  }),
);

/**
 * The values a task's entry is prefilled with, in the shape `entries.values`
 * takes for that kind. Typed per kind by the diary half; null when the reminder
 * prefills nothing.
 */
const taskDefaults = () => anyValue().describe('Prefilled entry values for the derived task; null when there are none.');

export const reminder = named(
  'Reminder',
  z.object({
    id: id(),
    subject: growOrSpaceRef,
    kind: reminderKind,
    label: z.string(),
    everyDays: z.number().int().nullable().describe('A rhythm. Exactly one of `everyDays` and `onceAt` is set.'),
    onceAt: instant().nullable(),
    assigneeId: id().nullable().describe('Who the derived task is for; null is everyone who may log.'),
    defaults: taskDefaults(),
    createdBy: id(),
    createdAt: instant(),
  }),
);

/** Where a derived task comes from: a reminder, the grow's scheme grid, the end of a plan step, or a plan's suggestion. */
export const taskSource = named('TaskSource', z.enum(['reminder', 'scheme', 'plan_step', 'plan_suggestion']));

/**
 * Derived on every read and never stored, which is why nothing has to be kept
 * in sync. "Done" is an entry carrying this `id` as its `taskId`.
 */
export const task = named(
  'Task',
  z.object({
    id: id().describe('Deterministic: the same source and the same due instant always produce the same id, so a completion needs nothing stored beforehand.'),
    source: taskSource,
    sourceId: id().nullable().describe('The reminder or plan step it was derived from; null for a task the scheme grid implies.'),
    subject: growOrSpaceRef,
    kind: reminderKind,
    label: z.string(),
    dueAt: instant(),
    assigneeId: id().nullable(),
    defaults: taskDefaults(),
    done: z.boolean(),
  }),
);

/** One phase and the plants in it, for a grow whose plants are not all in the same phase. */
export const phaseGroup = named(
  'PhaseGroup',
  z.object({
    stage: growthStage,
    preset: z.string().nullable(),
    phaseDay: z.number().int(),
    plantIds: z.array(id()),
  }),
);

/** Where the plants are now, from the open placements. */
export const growLocation = named(
  'GrowLocation',
  z.object({
    spaceId: id().nullable(),
    plantIds: z.array(id()),
  }),
);

/**
 * What the grow's `phases[]` and `placements[]` mean, worked out once in the
 * serialiser so that no client counts days itself.
 */
export const growSummary = named(
  'GrowSummary',
  z.object({
    dayNumber: z
      .number()
      .int()
      .nullable()
      .describe('1 on the day the first phase started, counted to `endedAt` once the grow has ended; null before the first phase.'),
    stage: growthStage.nullable().describe('The stage of the largest group of plants.'),
    preset: z.string().nullable(),
    phaseDay: z.number().int().nullable(),
    weekNumber: z.number().int().nullable().describe("Counted like `dayNumber`, so it lines up with the feeding scheme's grid."),
    isAuto: z.boolean().describe('The phase was set by a preset or by the plan rather than by hand.'),
    groups: z.array(phaseGroup).describe('Empty while every plant shares the headline phase; otherwise every group, that one included.'),
    locations: z.array(growLocation),
  }),
);

/**
 * The grow with what its phases and placements mean worked out beside it. The
 * summary is computed in the serialiser, so it rides on every answer that
 * carries a grow - `GET /grows/{id}` as much as a page of them - and no client
 * counts days for itself.
 */
export const growListItem = named('GrowListItem', grow.extend({ summary: growSummary }));

/**
 * `POST /spaces`. A space is little more than a name and a kind; the room it
 * hangs in and the two settings have defaults, so the sheet that creates one
 * asks for two fields.
 */
export const spaceCreate = named(
  'SpaceCreate',
  space
    .pick({ kind: true, name: true, roomId: true, presetPrompt: true, retention: true })
    .partial({ roomId: true, presetPrompt: true, retention: true }),
);

/**
 * `PATCH /spaces/{id}`: the same fields, each only if it changes. `archivedAt`
 * is not among them - archiving is a route of its own, so that ending a space's
 * life is never something a settings form does in passing.
 */
export const spaceUpdate = named('SpaceUpdate', spaceCreate.partial());

/*
 * `PUT /spaces/{id}/archive` and the `DELETE` that undoes it carry no body: the
 * method is the whole statement and there is nothing to archive a space *with*.
 * Both answer the space, whose `archivedAt` is what changed.
 */

/**
 * Placing a device in a space and taking it out again. The two ids are the whole
 * statement, so neither direction carries a body, and what comes back is this
 * pair rather than the device: `spaceId` is all that changed, and what a device
 * is belongs to the device routes.
 */
export const devicePlacement = named(
  'DevicePlacement',
  z.object({
    deviceId: id(),
    spaceId: id().nullable().describe('The space the device now stands in; null once it has been taken out.'),
  }),
);

/**
 * What a client may do about the grow when a preset is applied to a space that
 * has no open grow: start one here, move an existing one here, or leave grows
 * out of it and change the climate only.
 */
export const growDecision = named('GrowDecision', z.enum(['start_grow', 'move_grow', 'climate_only']));

/**
 * What applying a preset did to a plan running on the same space. The plan
 * engine re-applies its step hourly and would undo the preset, so the plan is
 * skipped forward when its next step carries the requested stage and paused when
 * it does not.
 */
export const presetPlanEffect = named('PresetPlanEffect', z.enum(['none', 'skipped', 'paused']));

/**
 * `POST /spaces/{id}/preset-applications`. A preset is a climate preset on top
 * of a botanical stage, and applying one writes the space's controllers and,
 * where a grow is open there, its phase.
 *
 * `decision` is sent on the second attempt, after an answer came back asking for
 * one; `growId` goes with `move_grow` and is read with nothing else.
 */
export const presetApplicationCreate = named(
  'PresetApplicationCreate',
  z.object({
    stage: growthStage,
    preset: z.string().nullable().optional().describe("Absent or null applies the stage's own targets with no preset on top."),
    decision: growDecision.optional(),
    growId: id().optional().describe('The grow to move here.'),
  }),
);

/**
 * What applying a preset did. Nothing of it is stored - what lasts is the phase,
 * the devices' settings and the diary entry - so the answer states what happened
 * rather than a row that could be read back afterwards.
 *
 * `decisions` is empty unless `growDecisionNeeded` is true, and is then what the
 * client may offer. The climate has been written either way, so somebody who
 * closes that sheet has still changed the tent.
 */
export const presetApplication = named(
  'PresetApplication',
  z.object({
    spaceId: id(),
    stage: growthStage,
    preset: z.string().nullable(),
    appliedAt: instant(),
    deviceIds: z.array(id()).describe('The controllers the targets were written to; empty in a space that has none.'),
    growId: id().nullable().describe('The grow whose phase was set; null when only the climate was applied.'),
    phaseId: id().nullable(),
    growDecisionNeeded: z.boolean().describe('No open grow was found here, so no phase was written and the client asks what to do about it.'),
    decisions: z.array(growDecision),
    planEffect: presetPlanEffect,
  }),
);

/**
 * `POST /spaces/{id}/members`. A member is named by id, which is what an invite
 * produces. There is no directory to search, so adding somebody by hand is for
 * an account that is already known; everybody else arrives through a code.
 */
export const membershipCreate = named('MembershipCreate', membership.pick({ userId: true, role: true }));

/**
 * `PATCH /spaces/{id}/members/{userId}`. The role is the only thing about a
 * membership that changes, and a change naming none would say nothing, so this
 * one is not partial.
 */
export const membershipUpdate = named('MembershipUpdate', membership.pick({ role: true }));

/**
 * `POST /spaces/{id}/invites`. The code, the space and who made it are the
 * server's; what is asked for is what the link grants and how long it lives, and
 * an absent or null `expiresAt` is a link that does not expire by itself.
 */
export const inviteCreate = named('InviteCreate', invite.pick({ role: true, expiresAt: true }).partial({ expiresAt: true }));

/**
 * `GET /invites/{code}`, the one route here that answers a stranger: whoever
 * holds a code sees what they are being invited to before signing in or signing
 * up. It carries no id at all - not the space's, not the inviter's - so a code
 * that was guessed discloses nothing that could be asked about afterwards, and
 * the inviter is named by handle, the only name others ever see.
 */
export const invitePreview = named(
  'InvitePreview',
  z.object({
    spaceName: z.string(),
    spaceKind: spaceKind,
    role: memberRole,
    invitedByHandle: z.string(),
    expiresAt: instant().nullable(),
    isValid: z.boolean().describe('False once the invite is revoked, expired or its space archived. Which of the three is not said, because the route is open.'),
  }),
);

/**
 * `POST /invites/{code}/acceptances`. The membership on its own would leave a
 * new member holding two ids and no name, and they have never seen this space
 * before, so what the code let them into comes back with it.
 */
export const inviteAcceptance = named(
  'InviteAcceptance',
  z.object({
    membership: membership,
    space: space,
  }),
);

/**
 * A row of the new-grow sheet: "Amnesia × 8" becomes eight plants labelled
 * "Amnesia 1" to "Amnesia 8".
 */
export const plantBatch = named(
  'PlantBatch',
  z.object({
    strain: z.string(),
    count: z.number().int().min(1),
  }),
);

export const growCreate = named(
  'GrowCreate',
  z.object({
    name: z.string(),
    description: z.string().nullable().optional(),
    type: growType,
    startedAt: instant().optional().describe('Defaults to now.'),
    spaceId: id().nullable().optional().describe('The opening placement; absent or null is "no fixed place".'),
    plants: z.array(plantBatch),
    scheme: growScheme.nullable().optional(),
    measurements: z.array(measurementDefinition).optional(),
    visibility: growVisibility.optional(),
  }),
);

/**
 * The manual stage picker and the plan write the same phase; `source`, the
 * targets and `setBy` are the server's to fill in, so a request carries neither.
 */
export const phaseCreate = named(
  'PhaseCreate',
  z.object({
    stage: growthStage,
    preset: z.string().nullable().optional(),
    startedAt: instant().optional().describe('Defaults to now.'),
    plantIds: z.array(id()).nullable().optional().describe('Absent or null is every plant.'),
  }),
);

/** A move: the open placement of these plants is closed and a new one opened. */
export const placementCreate = named(
  'PlacementCreate',
  z.object({
    spaceId: id().nullable().describe('Null moves the plants to no fixed place.'),
    startedAt: instant().optional().describe('Defaults to now.'),
    plantIds: z.array(id()).nullable().optional().describe('Absent or null is every plant.'),
  }),
);

export const harvestCreate = named(
  'HarvestCreate',
  z.object({
    plantIds: z.array(id()).nullable().optional().describe('Absent or null harvests every active plant; a list is a split harvest.'),
    harvestedAt: instant().optional().describe('Defaults to now.'),
    wetWeightG: z.number().nullable().optional(),
    dryWeightG: z.number().nullable().optional(),
  }),
);

/**
 * What a harvest answers. There is no harvest resource to hand back: what a
 * harvest leaves behind is a weight on every plant it named and one entry in the
 * timeline, so the answer is those rows rather than something that could be read
 * again afterwards.
 */
export const harvestResult = named(
  'HarvestResult',
  z.object({
    plants: z.array(plant).describe('The plants as they now stand, weights included.'),
    entryId: id(),
  }),
);

/**
 * These plants go their own way: they get their own phase, their own place, or
 * both, while the rest of the grow carries on. "4 drying in the fridge, 4 still
 * flowering" is one of these.
 */
export const splitCreate = named(
  'SplitCreate',
  z.object({
    plantIds: z.array(id()).min(1),
    startedAt: instant().optional().describe('Defaults to now.'),
    stage: growthStage.optional(),
    preset: z.string().nullable().optional(),
    spaceId: id().nullable().optional(),
  }),
);

/**
 * What a split answers: what it appended to the grow. A split that names a stage
 * opens a phase scoped to those plants, and one that names a space opens a
 * placement for them, so either may be null - but never both, because a split
 * that does neither has not split anything.
 */
export const splitResult = named(
  'SplitResult',
  z.object({
    plantIds: z.array(id()),
    phase: phase.nullable(),
    placement: placement.nullable(),
  }),
);

/**
 * `PATCH /grows/{id}`. What a person edits about the grow itself: plants,
 * phases and placements each have their own routes, `slug` is fixed at creation
 * so that making a grow public never changes its address, and the rendered film
 * and `isDemo` are the server's.
 */
export const growUpdate = named(
  'GrowUpdate',
  grow
    .pick({
      name: true,
      description: true,
      type: true,
      scheme: true,
      measurements: true,
      visibility: true,
      coverMediaId: true,
      startedAt: true,
      endedAt: true,
    })
    .partial(),
);

/**
 * `POST /grows/{id}/plants`. One plant: a whole row of the new-grow sheet is a
 * `PlantBatch` and is created with the grow, while what is added later is the
 * single plant that replaced a dead one. An absent `label` is made from the
 * strain and the next free number, as the sheet's rows are.
 */
export const plantCreate = named('PlantCreate', plant.pick({ strain: true, label: true }).partial({ label: true }));

/**
 * `PATCH /plants/{id}`. `harvest` is editable here as well as writable through
 * `POST /grows/{id}/harvests`, because a dry weight is typed in days after the
 * harvest and corrected more than once.
 */
export const plantUpdate = named('PlantUpdate', plant.pick({ strain: true, label: true, status: true, harvest: true }).partial());

/**
 * `PATCH /grows/{id}/phases/{phaseId}`: a phase that was entered with the wrong
 * stage or on the wrong day. `source` and `setBy` are not corrected with it -
 * who put the grow into this phase did not change because the date was typed
 * wrongly.
 */
export const phaseUpdate = named('PhaseUpdate', phaseCreate.partial());

/**
 * `PATCH /grows/{id}/placements/{placementId}`. Moving the plants is what
 * `POST /grows/{id}/placements` does; this repairs a placement recorded wrongly, `endedAt` included, which is also how a
 * placement left open is closed on the day the plants really left.
 */
export const placementUpdate = named(
  'PlacementUpdate',
  placement.pick({ spaceId: true, startedAt: true, endedAt: true, plantIds: true }).partial(),
);

/**
 * `POST /reminders`. Exactly one of `everyDays` and `onceAt` is set, which the
 * route enforces: a rhythm and a date would each derive tasks of their own and
 * the same reminder would come due twice.
 */
export const reminderCreate = named(
  'ReminderCreate',
  reminder
    .pick({ subject: true, kind: true, label: true, everyDays: true, onceAt: true, assigneeId: true, defaults: true })
    .partial({ assigneeId: true, defaults: true }),
);

/** `PATCH /reminders/{id}`: the same fields, each only if it changes. */
export const reminderUpdate = named('ReminderUpdate', reminderCreate.partial());

/**
 * `POST /tasks/{id}/completions`. "Done" is an entry carrying the task's id, so
 * this is what that entry is written with, and the answer is the entry itself: a
 * task is derived and has nothing of its own to store or to answer.
 *
 * `values` is the entry's own shape for the kind being logged, which the diary
 * half types per kind; left out, the task's `defaults` are used.
 */
export const taskCompletionCreate = named(
  'TaskCompletionCreate',
  z.object({
    occurredAt: instant().optional().describe('Defaults to now.'),
    text: z.string().nullable().optional(),
    plantIds: z.array(id()).nullable().optional().describe('Absent or null is every plant the task is about.'),
    values: anyValue().optional().describe("The entry's values for this kind; absent takes the task's `defaults`."),
  }),
);

export const spacePage = named('SpacePage', page(space));
export const membershipPage = named('MembershipPage', page(membership));
export const invitePage = named('InvitePage', page(invite));
export const growPage = named('GrowPage', page(growListItem));
export const plantPage = named('PlantPage', page(plant));
export const followPage = named('FollowPage', page(follow));
export const reminderPage = named('ReminderPage', page(reminder));
export const taskPage = named('TaskPage', page(task));
