"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plantCreate = exports.growUpdate = exports.splitResult = exports.splitCreate = exports.harvestResult = exports.harvestCreate = exports.placementCreate = exports.phaseCreate = exports.growCreate = exports.plantBatch = exports.inviteAcceptance = exports.invitePreview = exports.inviteCreate = exports.membershipUpdate = exports.membershipCreate = exports.presetApplication = exports.presetApplicationCreate = exports.presetPlanEffect = exports.growDecision = exports.devicePlacement = exports.spaceUpdate = exports.spaceCreate = exports.growListItem = exports.growSummary = exports.growLocation = exports.phaseGroup = exports.task = exports.taskCompletion = exports.taskSource = exports.reminder = exports.follow = exports.plant = exports.plantHarvest = exports.plantStatus = exports.grow = exports.growVisibility = exports.measurementDefinition = exports.growScheme = exports.growSchemeOrigin = exports.placement = exports.phase = exports.phaseTargets = exports.climateTargets = exports.phaseSource = exports.invite = exports.inviteState = exports.membership = exports.space = exports.spaceRetention = exports.presetPrompt = void 0;
exports.taskPage = exports.reminderPage = exports.followPage = exports.plantPage = exports.growPage = exports.invitePage = exports.membershipPage = exports.spacePage = exports.taskCompletionCreate = exports.reminderUpdate = exports.reminderCreate = exports.placementUpdate = exports.phaseUpdate = exports.plantUpdate = void 0;
const zod_1 = require("zod");
const common_js_1 = require("./common.js");
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
exports.presetPrompt = (0, common_js_1.named)('PresetPrompt', zod_1.z.enum(['ask', 'never']));
exports.spaceRetention = (0, common_js_1.named)('SpaceRetention', zod_1.z.object({
    climateDays: zod_1.z.number().int().positive().nullable().describe('How long raw climate points are kept; null is the install default.'),
}));
exports.space = (0, common_js_1.named)('Space', zod_1.z.object({
    id: (0, common_js_1.id)(),
    ownerId: (0, common_js_1.id)(),
    kind: common_js_1.spaceKind,
    name: zod_1.z.string(),
    roomId: (0, common_js_1.id)().nullable().describe('A space of kind `room`, one level deep. Null is a space that stands on its own.'),
    presetPrompt: exports.presetPrompt,
    retention: exports.spaceRetention,
    isDemo: zod_1.z.boolean(),
    archivedAt: (0, common_js_1.instant)().nullable().describe('A tombstone: history still names the space, so it is kept and no longer listed.'),
    createdAt: (0, common_js_1.instant)(),
}));
/**
 * One row per person who is not the owner. The owner is `spaces.ownerId` and
 * never a row here, so there is no `owner` role; a membership on a room covers
 * every space in it.
 */
exports.membership = (0, common_js_1.named)('Membership', zod_1.z.object({
    id: (0, common_js_1.id)(),
    spaceId: (0, common_js_1.id)(),
    userId: (0, common_js_1.id)(),
    role: common_js_1.memberRole,
    invitedBy: (0, common_js_1.id)().nullable(),
    inviteId: (0, common_js_1.id)().nullable().describe('The invite that was redeemed, or null for a member added by hand.'),
    createdAt: (0, common_js_1.instant)(),
}));
/** Maintained by the server: what the link has done since it was made. */
exports.inviteState = (0, common_js_1.named)('InviteState', zod_1.z.object({
    useCount: zod_1.z.number().int(),
    lastUsedAt: (0, common_js_1.instant)().nullable(),
}));
/**
 * One code serves the link, the typed code and the QR, so it is short enough to
 * read aloud. It is also the whole proof of the invitation, so it is answered
 * only to whoever may manage the space - a redemption is addressed by the code
 * itself and is told nothing about it.
 */
exports.invite = (0, common_js_1.named)('Invite', zod_1.z.object({
    id: (0, common_js_1.id)(),
    code: zod_1.z.string().describe('8 characters from the claim-code alphabet; unique.'),
    spaceId: (0, common_js_1.id)(),
    role: common_js_1.memberRole,
    createdBy: (0, common_js_1.id)(),
    expiresAt: (0, common_js_1.instant)().nullable(),
    revokedAt: (0, common_js_1.instant)().nullable(),
    state: exports.inviteState,
    createdAt: (0, common_js_1.instant)(),
}));
/** Who put the grow into this phase. `preset` and `plan` are what the "auto" tag is drawn from. */
exports.phaseSource = (0, common_js_1.named)('PhaseSource', zod_1.z.enum(['preset', 'plan', 'human']));
/** Day and night, as the controller's configuration states them. */
exports.climateTargets = (0, common_js_1.named)('ClimateTargets', zod_1.z.object({
    temperature: zod_1.z.number().nullable(),
    humidity: zod_1.z.number().nullable(),
}));
exports.phaseTargets = (0, common_js_1.named)('PhaseTargets', zod_1.z.object({
    day: exports.climateTargets,
    night: exports.climateTargets,
    co2: zod_1.z.number().nullable().describe('One target: the controller only raises CO2 while the light is on.'),
}));
/**
 * `stage` is the botanical fact and crosses the device protocol; `preset` is the
 * climate preset that was applied and is only a label. "Late flower" is
 * `flowering` with the preset `late_flowering`, which is how the screens draw a
 * seventh step without inventing a seventh stage. A preset table ships with the
 * client and may grow without the wire contract changing, so `preset` is a
 * string rather than an enum.
 */
exports.phase = (0, common_js_1.named)('Phase', zod_1.z.object({
    id: (0, common_js_1.id)(),
    stage: common_js_1.growthStage,
    preset: zod_1.z.string().nullable(),
    startedAt: (0, common_js_1.instant)(),
    source: exports.phaseSource,
    plantIds: zod_1.z.array((0, common_js_1.id)()).nullable().describe('Null is every plant of the grow; a list is the scope of a split.'),
    deviceId: (0, common_js_1.id)().nullable().describe('The controller the targets were read from, if any.'),
    targets: exports.phaseTargets.nullable().describe('A snapshot: Influx stores sensors and outputs, never setpoints, so a past phase has no other way to draw its target band.'),
    setBy: (0, common_js_1.id)().nullable().describe('The user, or null when a plan or a preset wrote the phase.'),
}));
/** Where a set of plants stands, for a stretch of time. Overlapping placements are how a grow is in two places at once. */
exports.placement = (0, common_js_1.named)('Placement', zod_1.z.object({
    id: (0, common_js_1.id)(),
    spaceId: (0, common_js_1.id)().nullable().describe('Null is "no fixed place".'),
    startedAt: (0, common_js_1.instant)(),
    endedAt: (0, common_js_1.instant)().nullable().describe('Null is open: this is where the plants are now.'),
    plantIds: zod_1.z.array((0, common_js_1.id)()).nullable().describe('Null is every plant of the grow.'),
}));
/**
 * Where the grid came from. A shipped scheme is a JSON asset of the client, so
 * the server knows only which asset and which version; `own` points at the
 * user's own scheme, whose own origin is `SchemeOrigin`.
 */
exports.growSchemeOrigin = (0, common_js_1.named)('GrowSchemeOrigin', zod_1.z.discriminatedUnion('type', [
    zod_1.z.object({
        type: zod_1.z.literal('asset'),
        assetId: zod_1.z.string(),
        version: zod_1.z.string().describe('The asset version the grid was taken from, so an edited asset never rewrites a past grow.'),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('own'),
        schemeId: (0, common_js_1.id)(),
    }),
]));
/**
 * The effective feeding grid of this grow. The server never reads a shipped
 * scheme, so the grow carries the grid itself: that is also what keeps a grow's
 * history stable when the scheme it came from is edited later.
 */
exports.growScheme = (0, common_js_1.named)('GrowScheme', zod_1.z.object({
    origin: exports.growSchemeOrigin,
    strength: zod_1.z.number().describe('Multiplier on the printed amounts; 1 is the scheme as published.'),
    waterEc: zod_1.z.number().nullable().describe("The tap water's own EC, which the scheme's figures are read on top of."),
    plantType: zod_1.z.string().describe("The scheme's own selector, such as its medium or plant type; the server does not interpret it."),
    flipWeek: zod_1.z.number().int().nullable().describe('The week the light is flipped; null for an autoflower.'),
    edited: zod_1.z.boolean().describe('The grid was changed by hand and no longer matches its origin.'),
    grid: zod_1.z.array(common_js_1.schemeWeek),
}));
/** What this grow measures beyond climate. `entries.values.readings` is keyed by `key`. */
exports.measurementDefinition = (0, common_js_1.named)('MeasurementDefinition', zod_1.z.object({
    key: zod_1.z.string(),
    name: zod_1.z.string(),
    unit: zod_1.z.string(),
    perPlant: zod_1.z.boolean().describe('A reading is taken per plant rather than for the grow.'),
    target: zod_1.z.number().nullable(),
    chart: zod_1.z.boolean().describe('Drawn as a series beside the climate charts.'),
}));
exports.growVisibility = (0, common_js_1.named)('GrowVisibility', zod_1.z.enum(['private', 'public']));
exports.grow = (0, common_js_1.named)('Grow', zod_1.z.object({
    id: (0, common_js_1.id)(),
    ownerId: (0, common_js_1.id)(),
    name: zod_1.z.string(),
    description: zod_1.z.string().nullable(),
    type: common_js_1.growType,
    phases: zod_1.z.array(exports.phase).describe('Ordered by `startedAt`. The single truth for the day counter, the phase and the "auto" tag.'),
    placements: zod_1.z.array(exports.placement),
    scheme: exports.growScheme.nullable(),
    measurements: zod_1.z.array(exports.measurementDefinition),
    visibility: exports.growVisibility,
    slug: zod_1.z.string().describe('Unique and stable, assigned at creation, so making a grow public never changes its address.'),
    coverMediaId: (0, common_js_1.id)().nullable(),
    filmMediaId: (0, common_js_1.id)().nullable().describe('The whole-grow timelapse, once it has been rendered.'),
    startedAt: (0, common_js_1.instant)(),
    endedAt: (0, common_js_1.instant)().nullable(),
    isDemo: zod_1.z.boolean(),
    createdAt: (0, common_js_1.instant)(),
    updatedAt: (0, common_js_1.instant)(),
}));
exports.plantStatus = (0, common_js_1.named)('PlantStatus', zod_1.z.enum(['active', 'harvested', 'ended']));
/** Weights are stripped from every view but the owner's and a member's. */
exports.plantHarvest = (0, common_js_1.named)('PlantHarvest', zod_1.z.object({
    harvestedAt: (0, common_js_1.instant)(),
    wetWeightG: zod_1.z.number().nullable(),
    dryWeightG: zod_1.z.number().nullable(),
}));
/**
 * A plant is a document of its own, so a phase, a placement or a harvest can
 * name exactly these plants and a count is simply how many rows there are.
 */
exports.plant = (0, common_js_1.named)('Plant', zod_1.z.object({
    id: (0, common_js_1.id)(),
    growId: (0, common_js_1.id)(),
    strain: zod_1.z.string(),
    label: zod_1.z.string().describe('What the plant is called on a card, such as "Amnesia 3".'),
    status: exports.plantStatus,
    harvest: exports.plantHarvest.nullable(),
    createdAt: (0, common_js_1.instant)(),
}));
/**
 * One person following one grow. `PUT /follows/{growId}` and its `DELETE` carry
 * no body - the grow is in the path and a follow has nothing else to say - and
 * the `PUT` answers this. What the home screen draws for a followed grow is a
 * read model of the diary half rather than a fatter follow, because a follower
 * sees a public grow and only what its public page shows.
 */
exports.follow = (0, common_js_1.named)('Follow', zod_1.z.object({
    id: (0, common_js_1.id)(),
    userId: (0, common_js_1.id)(),
    growId: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
}));
/**
 * The values a task's entry is prefilled with, in the shape `entries.values`
 * takes for that kind. Typed per kind by the diary half; null when the reminder
 * prefills nothing.
 */
const taskDefaults = () => (0, common_js_1.anyValue)().describe('Prefilled entry values for the derived task; null when there are none.');
exports.reminder = (0, common_js_1.named)('Reminder', zod_1.z.object({
    id: (0, common_js_1.id)(),
    subject: common_js_1.growOrSpaceRef,
    kind: common_js_1.reminderKind,
    label: zod_1.z.string(),
    everyDays: zod_1.z.number().int().nullable().describe('A rhythm. Exactly one of `everyDays` and `onceAt` is set.'),
    onceAt: (0, common_js_1.instant)().nullable(),
    assigneeId: (0, common_js_1.id)().nullable().describe('Who the derived task is for; null is everyone who may log.'),
    defaults: taskDefaults(),
    createdBy: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
}));
/** Where a derived task comes from: a reminder, the grow's scheme grid, the end of a plan step, or a plan's suggestion. */
exports.taskSource = (0, common_js_1.named)('TaskSource', zod_1.z.enum(['reminder', 'scheme', 'plan_step', 'plan_suggestion']));
/**
 * The entry that ticked a task off, as the list of what was done names it: a
 * task has nothing of its own to say when it was done, so it says which line
 * did and lets that line carry the instant and the author.
 */
exports.taskCompletion = (0, common_js_1.named)('TaskCompletion', zod_1.z.object({
    entryId: (0, common_js_1.id)(),
    occurredAt: (0, common_js_1.instant)(),
    authorId: (0, common_js_1.id)().nullable(),
}));
/**
 * Derived on every read and never stored, which is why nothing has to be kept
 * in sync. "Done" is an entry carrying this `id` as its `taskId`.
 */
exports.task = (0, common_js_1.named)('Task', zod_1.z.object({
    id: (0, common_js_1.id)().describe('Deterministic: the same source and the same due instant always produce the same id, so a completion needs nothing stored beforehand.'),
    source: exports.taskSource,
    sourceId: (0, common_js_1.id)().nullable().describe('The reminder or plan step it was derived from; null for a task the scheme grid implies.'),
    subject: common_js_1.growOrSpaceRef,
    kind: common_js_1.reminderKind,
    label: zod_1.z.string(),
    dueAt: (0, common_js_1.instant)(),
    assigneeId: (0, common_js_1.id)().nullable(),
    defaults: taskDefaults(),
    done: zod_1.z.boolean(),
    completion: exports.taskCompletion.nullable().describe('The entry that ticked it off; null while it is still waiting.'),
}));
/** One phase and the plants in it, for a grow whose plants are not all in the same phase. */
exports.phaseGroup = (0, common_js_1.named)('PhaseGroup', zod_1.z.object({
    stage: common_js_1.growthStage,
    preset: zod_1.z.string().nullable(),
    phaseDay: zod_1.z.number().int(),
    plantIds: zod_1.z.array((0, common_js_1.id)()),
}));
/** Where the plants are now, from the open placements. */
exports.growLocation = (0, common_js_1.named)('GrowLocation', zod_1.z.object({
    spaceId: (0, common_js_1.id)().nullable(),
    plantIds: zod_1.z.array((0, common_js_1.id)()),
}));
/**
 * What the grow's `phases[]` and `placements[]` mean, worked out once in the
 * serialiser so that no client counts days itself.
 */
exports.growSummary = (0, common_js_1.named)('GrowSummary', zod_1.z.object({
    dayNumber: zod_1.z
        .number()
        .int()
        .nullable()
        .describe('1 on the day the first phase started, counted to `endedAt` once the grow has ended; null before the first phase.'),
    stage: common_js_1.growthStage.nullable().describe('The stage of the largest group of plants.'),
    preset: zod_1.z.string().nullable(),
    phaseDay: zod_1.z.number().int().nullable(),
    weekNumber: zod_1.z.number().int().nullable().describe("Counted like `dayNumber`, so it lines up with the feeding scheme's grid."),
    isAuto: zod_1.z.boolean().describe('The phase was set by a preset or by the plan rather than by hand.'),
    groups: zod_1.z.array(exports.phaseGroup).describe('Empty while every plant shares the headline phase; otherwise every group, that one included.'),
    locations: zod_1.z.array(exports.growLocation),
}));
/**
 * The grow with what its phases and placements mean worked out beside it. The
 * summary is computed in the serialiser, so it rides on every answer that
 * carries a grow - `GET /grows/{id}` as much as a page of them - and no client
 * counts days for itself.
 */
exports.growListItem = (0, common_js_1.named)('GrowListItem', exports.grow.extend({ summary: exports.growSummary }));
/**
 * `POST /spaces`. A space is little more than a name and a kind; the room it
 * hangs in and the two settings have defaults, so the sheet that creates one
 * asks for two fields.
 */
exports.spaceCreate = (0, common_js_1.named)('SpaceCreate', exports.space
    .pick({ kind: true, name: true, roomId: true, presetPrompt: true, retention: true })
    .partial({ roomId: true, presetPrompt: true, retention: true }));
/**
 * `PATCH /spaces/{id}`: the same fields, each only if it changes. `archivedAt`
 * is not among them - archiving is a route of its own, so that ending a space's
 * life is never something a settings form does in passing.
 */
exports.spaceUpdate = (0, common_js_1.named)('SpaceUpdate', exports.spaceCreate.partial());
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
exports.devicePlacement = (0, common_js_1.named)('DevicePlacement', zod_1.z.object({
    deviceId: (0, common_js_1.id)(),
    spaceId: (0, common_js_1.id)().nullable().describe('The space the device now stands in; null once it has been taken out.'),
}));
/**
 * What a client may do about the grow when a preset is applied to a space that
 * has no open grow: start one here, move an existing one here, or leave grows
 * out of it and change the climate only.
 */
exports.growDecision = (0, common_js_1.named)('GrowDecision', zod_1.z.enum(['start_grow', 'move_grow', 'climate_only']));
/**
 * What applying a preset did to a plan running on the same space. The plan
 * engine re-applies its step hourly and would undo the preset, so the plan is
 * skipped forward when its next step carries the requested stage and paused when
 * it does not.
 */
exports.presetPlanEffect = (0, common_js_1.named)('PresetPlanEffect', zod_1.z.enum(['none', 'skipped', 'paused']));
/**
 * `POST /spaces/{id}/preset-applications`. A preset is a climate preset on top
 * of a botanical stage, and applying one writes the space's controllers and,
 * where a grow is open there, its phase.
 *
 * `decision` is sent on the second attempt, after an answer came back asking for
 * one; `growId` goes with `move_grow` and is read with nothing else.
 */
exports.presetApplicationCreate = (0, common_js_1.named)('PresetApplicationCreate', zod_1.z.object({
    stage: common_js_1.growthStage,
    preset: zod_1.z.string().nullable().optional().describe("Absent or null applies the stage's own targets with no preset on top."),
    decision: exports.growDecision.optional(),
    growId: (0, common_js_1.id)().optional().describe('The grow to move here.'),
}));
/**
 * What applying a preset did. Nothing of it is stored - what lasts is the phase,
 * the devices' settings and the diary entry - so the answer states what happened
 * rather than a row that could be read back afterwards.
 *
 * `decisions` is empty unless `growDecisionNeeded` is true, and is then what the
 * client may offer. The climate has been written either way, so somebody who
 * closes that sheet has still changed the tent.
 */
exports.presetApplication = (0, common_js_1.named)('PresetApplication', zod_1.z.object({
    spaceId: (0, common_js_1.id)(),
    stage: common_js_1.growthStage,
    preset: zod_1.z.string().nullable(),
    appliedAt: (0, common_js_1.instant)(),
    deviceIds: zod_1.z.array((0, common_js_1.id)()).describe('The controllers the targets were written to; empty in a space that has none.'),
    growId: (0, common_js_1.id)().nullable().describe('The grow whose phase was set; null when only the climate was applied.'),
    phaseId: (0, common_js_1.id)().nullable(),
    growDecisionNeeded: zod_1.z.boolean().describe('No open grow was found here, so no phase was written and the client asks what to do about it.'),
    decisions: zod_1.z.array(exports.growDecision),
    planEffect: exports.presetPlanEffect,
}));
/**
 * `POST /spaces/{id}/members`. A member is named by id, which is what an invite
 * produces. There is no directory to search, so adding somebody by hand is for
 * an account that is already known; everybody else arrives through a code.
 */
exports.membershipCreate = (0, common_js_1.named)('MembershipCreate', exports.membership.pick({ userId: true, role: true }));
/**
 * `PATCH /spaces/{id}/members/{userId}`. The role is the only thing about a
 * membership that changes, and a change naming none would say nothing, so this
 * one is not partial.
 */
exports.membershipUpdate = (0, common_js_1.named)('MembershipUpdate', exports.membership.pick({ role: true }));
/**
 * `POST /spaces/{id}/invites`. The code, the space and who made it are the
 * server's; what is asked for is what the link grants and how long it lives, and
 * an absent or null `expiresAt` is a link that does not expire by itself.
 */
exports.inviteCreate = (0, common_js_1.named)('InviteCreate', exports.invite.pick({ role: true, expiresAt: true }).partial({ expiresAt: true }));
/**
 * `GET /invites/{code}`, the one route here that answers a stranger: whoever
 * holds a code sees what they are being invited to before signing in or signing
 * up. It carries no id at all - not the space's, not the inviter's - so a code
 * that was guessed discloses nothing that could be asked about afterwards, and
 * the inviter is named by handle, the only name others ever see.
 */
exports.invitePreview = (0, common_js_1.named)('InvitePreview', zod_1.z.object({
    spaceName: zod_1.z.string(),
    spaceKind: common_js_1.spaceKind,
    role: common_js_1.memberRole,
    invitedByHandle: zod_1.z.string(),
    expiresAt: (0, common_js_1.instant)().nullable(),
    isValid: zod_1.z.boolean().describe('False once the invite is revoked, expired or its space archived. Which of the three is not said, because the route is open.'),
}));
/**
 * `POST /invites/{code}/acceptances`. The membership on its own would leave a
 * new member holding two ids and no name, and they have never seen this space
 * before, so what the code let them into comes back with it.
 */
exports.inviteAcceptance = (0, common_js_1.named)('InviteAcceptance', zod_1.z.object({
    membership: exports.membership,
    space: exports.space,
}));
/**
 * A row of the new-grow sheet: "Amnesia × 8" becomes eight plants labelled
 * "Amnesia 1" to "Amnesia 8".
 */
exports.plantBatch = (0, common_js_1.named)('PlantBatch', zod_1.z.object({
    strain: zod_1.z.string(),
    count: zod_1.z.number().int().min(1),
}));
exports.growCreate = (0, common_js_1.named)('GrowCreate', zod_1.z.object({
    name: zod_1.z.string(),
    description: zod_1.z.string().nullable().optional(),
    type: common_js_1.growType,
    startedAt: (0, common_js_1.instant)().optional().describe('Defaults to now.'),
    spaceId: (0, common_js_1.id)().nullable().optional().describe('The opening placement; absent or null is "no fixed place".'),
    plants: zod_1.z.array(exports.plantBatch),
    scheme: exports.growScheme.nullable().optional(),
    measurements: zod_1.z.array(exports.measurementDefinition).optional(),
    visibility: exports.growVisibility.optional(),
}));
/**
 * The manual stage picker and the plan write the same phase; `source`, the
 * targets and `setBy` are the server's to fill in, so a request carries neither.
 */
exports.phaseCreate = (0, common_js_1.named)('PhaseCreate', zod_1.z.object({
    stage: common_js_1.growthStage,
    preset: zod_1.z.string().nullable().optional(),
    startedAt: (0, common_js_1.instant)().optional().describe('Defaults to now.'),
    plantIds: zod_1.z.array((0, common_js_1.id)()).nullable().optional().describe('Absent or null is every plant.'),
}));
/** A move: the open placement of these plants is closed and a new one opened. */
exports.placementCreate = (0, common_js_1.named)('PlacementCreate', zod_1.z.object({
    spaceId: (0, common_js_1.id)().nullable().describe('Null moves the plants to no fixed place.'),
    startedAt: (0, common_js_1.instant)().optional().describe('Defaults to now.'),
    plantIds: zod_1.z.array((0, common_js_1.id)()).nullable().optional().describe('Absent or null is every plant.'),
}));
exports.harvestCreate = (0, common_js_1.named)('HarvestCreate', zod_1.z.object({
    plantIds: zod_1.z.array((0, common_js_1.id)()).nullable().optional().describe('Absent or null harvests every active plant; a list is a split harvest.'),
    harvestedAt: (0, common_js_1.instant)().optional().describe('Defaults to now.'),
    wetWeightG: zod_1.z.number().nullable().optional(),
    dryWeightG: zod_1.z.number().nullable().optional(),
}));
/**
 * What a harvest answers. There is no harvest resource to hand back: what a
 * harvest leaves behind is a weight on every plant it named and one entry in the
 * timeline, so the answer is those rows rather than something that could be read
 * again afterwards.
 */
exports.harvestResult = (0, common_js_1.named)('HarvestResult', zod_1.z.object({
    plants: zod_1.z.array(exports.plant).describe('The plants as they now stand, weights included.'),
    entryId: (0, common_js_1.id)(),
}));
/**
 * These plants go their own way: they get their own phase, their own place, or
 * both, while the rest of the grow carries on. "4 drying in the fridge, 4 still
 * flowering" is one of these.
 */
exports.splitCreate = (0, common_js_1.named)('SplitCreate', zod_1.z.object({
    plantIds: zod_1.z.array((0, common_js_1.id)()).min(1),
    startedAt: (0, common_js_1.instant)().optional().describe('Defaults to now.'),
    stage: common_js_1.growthStage.optional(),
    preset: zod_1.z.string().nullable().optional(),
    spaceId: (0, common_js_1.id)().nullable().optional(),
}));
/**
 * What a split answers: what it appended to the grow. A split that names a stage
 * opens a phase scoped to those plants, and one that names a space opens a
 * placement for them, so either may be null - but never both, because a split
 * that does neither has not split anything.
 */
exports.splitResult = (0, common_js_1.named)('SplitResult', zod_1.z.object({
    plantIds: zod_1.z.array((0, common_js_1.id)()),
    phase: exports.phase.nullable(),
    placement: exports.placement.nullable(),
}));
/**
 * `PATCH /grows/{id}`. What a person edits about the grow itself: plants,
 * phases and placements each have their own routes, `slug` is fixed at creation
 * so that making a grow public never changes its address, and the rendered film
 * and `isDemo` are the server's.
 */
exports.growUpdate = (0, common_js_1.named)('GrowUpdate', exports.grow
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
    .partial());
/**
 * `POST /grows/{id}/plants`. One plant: a whole row of the new-grow sheet is a
 * `PlantBatch` and is created with the grow, while what is added later is the
 * single plant that replaced a dead one. An absent `label` is made from the
 * strain and the next free number, as the sheet's rows are.
 */
exports.plantCreate = (0, common_js_1.named)('PlantCreate', exports.plant.pick({ strain: true, label: true }).partial({ label: true }));
/**
 * `PATCH /plants/{id}`. `harvest` is editable here as well as writable through
 * `POST /grows/{id}/harvests`, because a dry weight is typed in days after the
 * harvest and corrected more than once.
 */
exports.plantUpdate = (0, common_js_1.named)('PlantUpdate', exports.plant.pick({ strain: true, label: true, status: true, harvest: true }).partial());
/**
 * `PATCH /grows/{id}/phases/{phaseId}`: a phase that was entered with the wrong
 * stage or on the wrong day. `source` and `setBy` are not corrected with it -
 * who put the grow into this phase did not change because the date was typed
 * wrongly.
 */
exports.phaseUpdate = (0, common_js_1.named)('PhaseUpdate', exports.phaseCreate.partial());
/**
 * `PATCH /grows/{id}/placements/{placementId}`. Moving the plants is what
 * `POST /grows/{id}/placements` does; this repairs a placement recorded wrongly, `endedAt` included, which is also how a
 * placement left open is closed on the day the plants really left.
 */
exports.placementUpdate = (0, common_js_1.named)('PlacementUpdate', exports.placement.pick({ spaceId: true, startedAt: true, endedAt: true, plantIds: true }).partial());
/**
 * `POST /reminders`. Exactly one of `everyDays` and `onceAt` is set, which the
 * route enforces: a rhythm and a date would each derive tasks of their own and
 * the same reminder would come due twice.
 */
exports.reminderCreate = (0, common_js_1.named)('ReminderCreate', exports.reminder
    .pick({ subject: true, kind: true, label: true, everyDays: true, onceAt: true, assigneeId: true, defaults: true })
    .partial({ assigneeId: true, defaults: true }));
/** `PATCH /reminders/{id}`: the same fields, each only if it changes. */
exports.reminderUpdate = (0, common_js_1.named)('ReminderUpdate', exports.reminderCreate.partial());
/**
 * `POST /tasks/{id}/completions`. "Done" is an entry carrying the task's id, so
 * this is what that entry is written with, and the answer is the entry itself: a
 * task is derived and has nothing of its own to store or to answer.
 *
 * `values` is the entry's own shape for the kind being logged, which the diary
 * half types per kind; left out, the task's `defaults` are used.
 */
exports.taskCompletionCreate = (0, common_js_1.named)('TaskCompletionCreate', zod_1.z.object({
    occurredAt: (0, common_js_1.instant)().optional().describe('Defaults to now.'),
    text: zod_1.z.string().nullable().optional(),
    plantIds: zod_1.z.array((0, common_js_1.id)()).nullable().optional().describe('Absent or null is every plant the task is about.'),
    values: (0, common_js_1.anyValue)().optional().describe("The entry's values for this kind; absent takes the task's `defaults`."),
}));
exports.spacePage = (0, common_js_1.named)('SpacePage', (0, common_js_1.page)(exports.space));
exports.membershipPage = (0, common_js_1.named)('MembershipPage', (0, common_js_1.page)(exports.membership));
exports.invitePage = (0, common_js_1.named)('InvitePage', (0, common_js_1.page)(exports.invite));
exports.growPage = (0, common_js_1.named)('GrowPage', (0, common_js_1.page)(exports.growListItem));
exports.plantPage = (0, common_js_1.named)('PlantPage', (0, common_js_1.page)(exports.plant));
exports.followPage = (0, common_js_1.named)('FollowPage', (0, common_js_1.page)(exports.follow));
exports.reminderPage = (0, common_js_1.named)('ReminderPage', (0, common_js_1.page)(exports.reminder));
exports.taskPage = (0, common_js_1.named)('TaskPage', (0, common_js_1.page)(exports.task));
