import { Schema } from 'mongoose';

/** One fixed window, keyed by the route and the client address that spends it. */
export interface RateLimitWindow {
  _id: string;
  count: number;
  resetAt: Date;
}

export const rateLimitSchema: Schema = new Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    count: {
      type: Number,
      required: true,
    },
    resetAt: {
      type: Date,
      required: true,
    },
  },
  { versionKey: false },
);

// Housekeeping only, so a window nobody comes back to does not stay for ever.
// The guard compares `resetAt` itself rather than reading anything into a
// document being gone: the TTL monitor runs about once a minute, so a window
// that has run out outlives itself by up to that long.
rateLimitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });
