import { DateTime } from 'luxon';

/**
 * When a picture was taken, as the camera wrote it into the file: the EXIF
 * `DateTimeOriginal`, else the plain `DateTime`, read with the offset the camera
 * wrote beside it where it wrote one and in the account's zone where it did not.
 * Null for a file that carries none - a screenshot, a picture whose metadata a
 * messenger stripped - which leaves the line dated however it was.
 *
 * It looks for the TIFF block behind an `Exif\0\0` marker in the head of the
 * file rather than walking the container, which is the same block in a JPEG's
 * APP1 segment and in a HEIC's Exif item; a file that keeps it further in is
 * simply not dated by it.
 */
export async function takenAt(file: Blob, zone: string | null): Promise<Date | null> {
  try {
    const bytes = new Uint8Array(await read(file.slice(0, HEAD_BYTES)));
    const tiff = tiffStart(bytes);
    return tiff === null ? null : momentIn(new DataView(bytes.buffer, tiff), zone);
  } catch {
    return null;
  }
}

/** How much of the file is searched: an iPhone's HEIC keeps its Exif item well inside this, a JPEG's comes first. */
const HEAD_BYTES = 512 * 1024;

const EXIF_MARKER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
const INTEL = 0x49;
const MOTOROLA = 0x4d;

const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_TIME = 0x0132;
const TAG_TAKEN = 0x9003;
const TAG_TAKEN_OFFSET = 0x9011;

const read = (blob: Blob): Promise<ArrayBuffer> =>
  typeof blob.arrayBuffer === 'function'
    ? blob.arrayBuffer()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      });

/** Where the TIFF header behind the first Exif marker starts, if it is one. */
const tiffStart = (bytes: Uint8Array): number | null => {
  for (let at = 0; at + EXIF_MARKER.length + 8 <= bytes.length; at++) {
    if (!EXIF_MARKER.every((byte, index) => bytes[at + index] === byte)) continue;
    const start = at + EXIF_MARKER.length;
    // The byte order, "II" or "MM", spelled as bytes: a quoted pair of capital Ms reads as a date format to the zone sweep.
    if (bytes[start] === bytes[start + 1] && (bytes[start] === INTEL || bytes[start] === MOTOROLA)) return start;
  }
  return null;
};

/** The moment the TIFF block names, read through its first directory and the Exif directory it points at. */
const momentIn = (view: DataView, zone: string | null): Date | null => {
  const little = view.getUint8(0) === INTEL;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);

  /** The tags of one directory, each with the offset of its 12-byte entry. */
  const directory = (at: number): Map<number, number> => {
    const tags = new Map<number, number>();
    const count = u16(at);
    for (let index = 0; index < count; index++) tags.set(u16(at + 2 + index * 12), at + 2 + index * 12);
    return tags;
  };

  /** An ASCII value: inside the entry when it fits in four bytes, behind the offset it holds when it does not. */
  const text = (entry: number | undefined): string | null => {
    if (entry === undefined) return null;
    const length = u32(entry + 4);
    const from = length <= 4 ? entry + 8 : u32(entry + 8);
    let value = '';
    for (let index = 0; index < length; index++) {
      const code = view.getUint8(from + index);
      if (code === 0) break;
      value += String.fromCharCode(code);
    }
    return value;
  };

  const first = directory(u32(4));
  const exifAt = first.get(TAG_EXIF_IFD);
  const exif = exifAt === undefined ? new Map<number, number>() : directory(u32(exifAt + 8));

  return parse(text(exif.get(TAG_TAKEN)) ?? text(first.get(TAG_DATE_TIME)), text(exif.get(TAG_TAKEN_OFFSET)), zone);
};

/** "2026:10:13 09:15:42", with "+02:00" where the camera said which offset it was at. */
const parse = (stamp: string | null, offset: string | null, zone: string | null): Date | null => {
  const parts = stamp?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  const where = offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? `UTC${offset}` : (zone ?? undefined);
  const at = DateTime.fromObject({ year, month, day, hour, minute, second }, { zone: where });

  return at.isValid ? at.toJSDate() : null;
};
