/** What a failure says about itself: its stack where it has one. */
export const errorText = (error: unknown): string => (error instanceof Error ? (error.stack ?? error.message) : String(error));
