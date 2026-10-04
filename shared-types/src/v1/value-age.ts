/**
 * The one place the ages of a value are stated. The server decides `valueState`
 * from these and its own clock, and that verdict is the only one anything acts
 * on: no client works out a state the server will be told or asked about.
 *
 * A client does judge what it is drawing. The verdict on an answer was true when
 * the answer was made, and a screen keeps drawing that answer while the reader
 * looks at it and while a refresh fails, so it re-reads these same seconds
 * against the server-corrected clock to decide how old the figure in front of
 * somebody now is. That is a client aging a value it holds, never a second
 * opinion about one: it can only agree with the server or call the reading
 * older, never fresher.
 *
 * A device's own liveness is in no answer - `lastSeenAt` is the raw instant -
 * so the screens that draw a device rather than a reading judge it by these
 * same seconds. That is why this is a module of its own rather than a line in
 * `common.ts`: it carries no schema, so a client can import it without pulling
 * zod and the whole contract into its bundle.
 */
export const VALUE_AGE = { liveSeconds: 120, staleSeconds: 600 } as const;
