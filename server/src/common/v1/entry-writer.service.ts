import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { EntryMessage, EntrySource, EntryValues, Severity } from '@fg2/shared-types/v1';
import { MODEL_V1 } from '@database/models';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { withoutCredentials } from '@common/log-path';
import { deviceEntryValues, deviceMessageFact, isHardwareInfo, parseDeviceMessage, severityOf } from './device-messages';

/**
 * The one place a row of `entries` is written.
 *
 * A diary line comes from four places - a person through the API, a device on
 * its log topic, the plan engine and the alarm engine - and the timeline only
 * reads as one thing if all four produce the same document. So the fields the
 * writer owns are not asked for: the id, when it was written down, how long it
 * may be taken back.
 *
 * The entry's kind is `values.kind`. The contract carries the kind twice, on the
 * entry and on the values that narrow by it, and this is the one place the two
 * could be made to disagree - so it has no opportunity to.
 */

/**
 * How long a person may take their own entry back. Nothing else gets a window:
 * a device's line, a plan step and an alarm are not anybody's to undo, and
 * removing what they recorded is the resource they are about.
 */
export const UNDO_WINDOW_SECONDS = 300;

/** What the entry is about. Each is null when the entry is not about one. */
export interface EntrySubject {
  growId?: string | null;
  spaceId?: string | null;
  deviceId?: string | null;
  cameraId?: string | null;
  /** Empty means the entry is about whatever it is attached to rather than about single plants. */
  plantIds?: string[];
}

export interface EntryDraft extends EntrySubject {
  source: EntrySource;
  /** Null for everything a device, the plan engine or an alarm wrote. */
  authorId: string | null;
  values: EntryValues;
  /** When the thing happened, which is not when it was written down. Defaults to now. */
  occurredAt?: Date;
  taskId?: string | null;
  alertId?: string | null;
  severity?: Severity | null;
  /** What a person wrote. A device's line is `message` instead. */
  text?: string | null;
  message?: EntryMessage | null;
  mediaIds?: string[];
}

/** One line off a device's log topic, with what the protocol module knows about where the device stands. */
export interface DeviceLogLine extends EntrySubject {
  deviceId: string;
  /** The raw `message` of the log payload: a `message-key:param` line or free text. */
  line: string;
  /** The `severity` of the log payload, as the firmware counts it. */
  severity?: number | null;
  occurredAt?: Date;
}

@Injectable()
export class EntryWriterService {
  constructor(@InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>) {}

  public async write(draft: EntryDraft): Promise<EntryDocument> {
    const createdAt = new Date();
    const entry: EntryDocument = {
      id: uuidv4(),
      createdAt,
      kind: draft.values.kind,
      occurredAt: draft.occurredAt ?? createdAt,
      source: draft.source,
      authorId: draft.authorId,
      growId: draft.growId ?? null,
      spaceId: draft.spaceId ?? null,
      deviceId: draft.deviceId ?? null,
      plantIds: draft.plantIds ?? [],
      cameraId: draft.cameraId ?? null,
      taskId: draft.taskId ?? null,
      alertId: draft.alertId ?? null,
      severity: draft.severity ?? null,
      text: draft.text === null || draft.text === undefined ? null : withoutCredentials(draft.text),
      message: saidWithoutCredentials(draft.message ?? null),
      values: draft.values,
      mediaIds: draft.mediaIds ?? [],
      undoUntil: undoUntil(draft, createdAt),
    };

    await this.entries.create(entry);
    return entry;
  }

  /**
   * A line a device published. `hardware-info:` rides the same topic and is a
   * report about the hardware rather than something that happened, so it is
   * refused here as well as handled before - the log topic has one reader and it
   * must not be possible for it to reach the diary.
   *
   * A line about the camera is attached to the camera the caller names; a line
   * about the device is not, even when the device has one.
   */
  public async writeDeviceLine(log: DeviceLogLine): Promise<EntryDocument | null> {
    if (isHardwareInfo(log.line)) return null;

    const { message, text } = parseDeviceMessage(log.line);
    const fact = deviceMessageFact(message);

    return this.write({
      source: 'device',
      authorId: null,
      values: deviceEntryValues(fact.kind),
      occurredAt: log.occurredAt,
      growId: log.growId,
      spaceId: log.spaceId,
      deviceId: log.deviceId,
      plantIds: log.plantIds,
      cameraId: fact.aboutCamera ? (log.cameraId ?? null) : null,
      severity: severityOf(log.severity),
      text,
      message,
    });
  }
}

const undoUntil = (draft: EntryDraft, createdAt: Date): Date | null =>
  draft.source === 'human' && draft.authorId ? new Date(createdAt.getTime() + UNDO_WINDOW_SECONDS * 1000) : null;

/**
 * A password never becomes a diary line.
 *
 * Three of the things written on one arrive with a whole URL inside them: the
 * reason ffmpeg gives for a stream it could not open, which quotes the command
 * line back with the camera's `user:password@` still in it; the error a webhook
 * that could not be reached reports; and whatever a device chooses to log about
 * itself. The camera row already refuses to answer its own address with the
 * credentials on it - "the credentials it is opened with are the server's to
 * keep, and the owner is no more entitled to read them back than anybody else"
 * - and a diary that keeps them hands back in the rail, the week card and the
 * export exactly what that refusal is about.
 *
 * It is done here rather than on the way out because this is the one place a
 * row of `entries` is written and there are a dozen places one is read, and
 * because a secret that is never stored cannot be leaked by the next reader
 * somebody adds. A person's own words go through it too: a grower who pastes
 * their camera's address into a note has written a password into their own
 * export, and nothing but a credential has this shape.
 */
const saidWithoutCredentials = (message: EntryMessage | null): EntryMessage | null =>
  message === null ? null : { key: message.key, params: message.params.map(parameter => withoutCredentials(parameter)) };
