import { Schema } from 'mongoose';
import { growOrSpaceType, reminderKind } from '@fg2/shared-types/v1-schemas';
import type { Reminder } from '@fg2/shared-types/v1';

/**
 * What a task is derived from. Tasks themselves are never stored, so this is the
 * only row a rhythm has: `everyDays` is one, `onceAt` a single date, and exactly
 * one of the two is set.
 */
export type ReminderDocument = Omit<Reminder, 'onceAt' | 'createdAt'> & {
  onceAt: Date | null;
  createdAt: Date;
};

export const remindersSchema = new Schema<ReminderDocument>(
  {
    id: { type: String, required: true, unique: true },
    subject: {
      type: { type: String, enum: growOrSpaceType.options, required: true },
      id: { type: String, required: true },
    },
    kind: { type: String, enum: reminderKind.options, required: true },
    label: { type: String, required: true },
    everyDays: { type: Number, default: null },
    onceAt: { type: Date, default: null },
    assigneeId: { type: String, default: null },
    // Entry values in the shape `entries.values` takes for the reminder's kind,
    // which the diary half types and this collection only carries.
    defaults: { type: Schema.Types.Mixed, default: null },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { collection: 'reminders', versionKey: false },
);

// Tasks are derived per grow and per space, so every task read starts here.
remindersSchema.index({ 'subject.type': 1, 'subject.id': 1 });
