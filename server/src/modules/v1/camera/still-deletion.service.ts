import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { StillDeletion, StillDeletionFilm, StillDeletionHour, StillDeletionImpact } from '@fg2/shared-types/v1';
import { badRequest, unprocessable } from '@common/v1/problem';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { CamerasService } from './cameras.service';
import { MediaPosition, MediaService } from './media.service';
import { TimelapseService } from './timelapse.service';

/** How many stills one round trip deletes. */
const DELETE_BATCH = 500;

/** The stills a selection names: the ones that go, and the ones a diary holds on to, which stay. */
interface Selection {
  all: MediaPosition[];
  doomed: MediaPosition[];
  kept: string[];
}

/**
 * Deleting a camera's stills, one by one or a span of them, because something
 * was pictured that nobody should keep. It is for good, at once: the stills go
 * with their bytes, and so does every film holding one of them, which is then
 * made again from what is left.
 *
 * A still a diary line names or a grow shows as its cover stays. The diary is
 * somebody's record, and it is changed in the diary, not from the camera.
 */
@Injectable()
export class StillDeletionService {
  constructor(
    private readonly media: MediaService,
    private readonly builder: TimelapseService,
    private readonly cameras: CamerasService,
  ) {}

  /** What deleting the selection would do, deleting nothing. */
  public async preview(camera: CameraDocument, body: StillDeletion): Promise<StillDeletionImpact> {
    const selection = await this.select(camera, body);
    const films = await this.filmsHolding(camera.id, selection.doomed);

    const told = await Promise.all(
      films.map(async film => {
        const span = await this.builder.spanOfFilm(film);
        // Only the film's own camera's stills are what it is made of; the camera beside it leaves gaps.
        const going = film.cameraId === camera.id && span ? selection.doomed.filter(still => within(still, span)).length : 0;
        const remade = span !== null && film.window !== null && film.cameraId !== null && (await this.builder.filmable(film.cameraId, span, going));
        return filmOf(film, remade);
      }),
    );

    return this.impact(camera, selection, told);
  }

  public async delete(camera: CameraDocument, body: StillDeletion): Promise<StillDeletionImpact> {
    const selection = await this.select(camera, body);
    const ids = selection.doomed.map(still => still.id);
    for (let start = 0; start < ids.length; start += DELETE_BATCH) await this.media.deleteMany(ids.slice(start, start + DELETE_BATCH));

    // Counted before the films are looked for: one stored from frames read before is found below, one stored after
    // is not stored at all.
    this.builder.stillsErased(camera.id);

    const told: StillDeletionFilm[] = [];
    for (const film of await this.filmsHolding(camera.id, selection.doomed)) told.push(filmOf(film, await this.builder.remake(film)));

    return this.impact(camera, selection, told);
  }

  private async select(camera: CameraDocument, body: StillDeletion): Promise<Selection> {
    const span = body.startsAt !== undefined || body.endsAt !== undefined;
    if (body.ids ? span || body.except : !(body.startsAt && body.endsAt)) {
      throw badRequest('selection_unclear', 'Name the stills either one by one in `ids`, or by both ends of a span.');
    }
    if (body.startsAt && body.endsAt && body.endsAt < body.startsAt) throw unprocessable('span_backwards', 'A span ends after it begins.');

    const except = new Set(body.except ?? []);
    const all: MediaPosition[] = [];
    const stills = this.media.positions({
      cameraId: camera.id,
      kind: 'still',
      ...(body.ids ? { ids: body.ids } : { range: { startsAt: new Date(body.startsAt!), endsAt: new Date(body.endsAt!) } }),
    });
    for await (const still of stills) if (!except.has(still.id)) all.push(still);

    const held = all.length > 0 ? await this.media.heldByDiaries() : new Set<string>();
    return { all, doomed: all.filter(still => !held.has(still.id)), kept: all.filter(still => held.has(still.id)).map(still => still.id) };
  }

  /** The films that hold one of these stills, which are oldest first. */
  private async filmsHolding(cameraId: string, stills: MediaPosition[]): Promise<MediaDocument[]> {
    if (stills.length === 0) return [];

    const times = stills.map(still => still.capturedAt.getTime());
    const films = await this.media.filmsAround(cameraId, stills[0].capturedAt, stills[stills.length - 1].capturedAt);
    return films
      .filter(film => holds(times, film.capturedAt.getTime(), film.endsAt?.getTime() ?? Infinity))
      .sort((one, other) => one.capturedAt.getTime() - other.capturedAt.getTime());
  }

  private async impact(camera: CameraDocument, selection: Selection, films: StillDeletionFilm[]): Promise<StillDeletionImpact> {
    return {
      stills: selection.doomed.length,
      kept: selection.kept,
      hours: hoursOf(selection.all, (await this.cameras.zoneOf(camera)) ?? 'UTC'),
      films,
    };
  }
}

const within = (still: MediaPosition, span: { startsAt: Date; endsAt: Date }): boolean =>
  still.capturedAt >= span.startsAt && still.capturedAt < span.endsAt;

/** Whether a time of the sorted ones lies from `from` to `until`. */
const holds = (times: number[], from: number, until: number): boolean => {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] < from) low = middle + 1;
    else high = middle;
  }

  return low < times.length && times[low] <= until;
};

const filmOf = (film: MediaDocument, remade: boolean): StillDeletionFilm => ({
  id: film.id,
  cameraId: film.cameraId ?? '',
  window: film.window ?? 'custom',
  startsAt: film.capturedAt.toISOString(),
  endsAt: film.endsAt?.toISOString() ?? null,
  remade,
});

/** The stills, oldest first, as the hours of the owner's clock they fall in, newest first. */
const hoursOf = (stills: MediaPosition[], zone: string): StillDeletionHour[] => {
  const hours: StillDeletionHour[] = [];

  for (const still of stills) {
    const at = DateTime.fromJSDate(still.capturedAt, { zone });
    const startsAt = (at.isValid ? at : DateTime.fromJSDate(still.capturedAt, { zone: 'UTC' })).startOf('hour').toUTC().toISO()!;
    const last = hours[hours.length - 1];
    if (last?.startsAt === startsAt) {
      last.stills++;
      last.newestId = still.id;
    } else {
      hours.push({ startsAt, stills: 1, newestId: still.id });
    }
  }

  return hours.reverse();
};
