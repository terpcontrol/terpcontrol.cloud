import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createDeflateRaw, crc32 } from 'node:zlib';

/**
 * A zip file, written one entry at a time into a stream.
 *
 * It is written here rather than taken from a package because an export is the
 * only thing in this server that wants one, and what it wants is the oldest
 * third of the format: a header, the bytes, and a directory at the end saying
 * where each of them began. Nothing is held in memory but that directory, so a
 * grow with four thousand photos in it costs what a grow with four costs.
 *
 * Every entry carries a data descriptor, which is what lets the bytes be
 * streamed: the size and the checksum are only known once they have gone past,
 * so they are written after the entry rather than before it. The header carries
 * an empty Zip64 record for the same reason - a file may turn out to be larger
 * than four gigabytes and by then there is no going back to widen the field.
 *
 * Text is deflated and pictures are stored. A JPEG is already compressed and
 * deflating it spends minutes to save nothing; a CSV of a season of climate is
 * nine tenths commas and digits and shrinks to a fraction of itself.
 */

const LOCAL_HEADER = 0x04034b50;
const DATA_DESCRIPTOR = 0x08074b50;
const CENTRAL_HEADER = 0x02014b50;
const ZIP64_END = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const END_OF_DIRECTORY = 0x06054b50;

/** The Zip64 extra field's own tag. */
const ZIP64_TAG = 0x0001;

/** Bit 3 says the sizes follow the data; bit 11 says the name is UTF-8, which every name here is. */
const FLAGS = 0x0008 | 0x0800;

const STORED = 0;
const DEFLATED = 8;

/** The version that understands Zip64, which every entry here is written for. */
const VERSION = 45;

/** What a 32-bit field holds when the real number no longer fits in it. */
const U32 = 0xffffffff;
const U16 = 0xffff;

const DESCRIPTOR_LENGTH = 24;

interface DirectoryEntry {
  name: Buffer;
  method: number;
  dosTime: number;
  dosDate: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

export class ZipWriter {
  private readonly directory: DirectoryEntry[] = [];
  private offset = 0;

  constructor(private readonly out: Writable) {}

  /**
   * One file. `body` is a buffer for what is already in hand and a stream for
   * what is not, which is how a picture goes from the bucket into the archive
   * without ever being held whole.
   */
  public async add(path: string, modifiedAt: Date, body: Buffer | Readable, deflate = false): Promise<void> {
    const name = Buffer.from(path, 'utf8');
    const method = deflate ? DEFLATED : STORED;
    const { dosTime, dosDate } = dosStamp(modifiedAt);
    const offset = this.offset;

    await this.write(localHeaderOf(name, method, dosTime, dosDate));

    // The checksum is of what went in and the compressed size of what came
    // out, so the counter sits before whatever compresses it.
    const counted = new Counter();
    const source = Buffer.isBuffer(body) ? Readable.from([body]) : body;
    const before = this.offset;
    await (deflate ? pipeline(source, counted, createDeflateRaw(), this.sink()) : pipeline(source, counted, this.sink()));
    const compressedSize = this.offset - before;

    await this.write(descriptorOf(counted.crc, compressedSize, counted.size));
    this.directory.push({ name, method, dosTime, dosDate, crc: counted.crc, compressedSize, size: counted.size, offset });
  }

  /** The directory and the records that point at it. Nothing may be added afterwards. */
  public async close(): Promise<void> {
    const startsAt = this.offset;
    for (const entry of this.directory) await this.write(centralEntryOf(entry));

    await this.write(endOf(this.directory.length, this.offset - startsAt, startsAt));
  }

  private write(chunk: Buffer): Promise<void> {
    this.offset += chunk.length;

    return new Promise((resolve, reject) => {
      this.out.write(chunk, error => (error ? reject(error) : resolve()));
    });
  }

  /**
   * The archive's own stream, as a destination a pipeline may finish with
   * without closing it - the next entry is written into the same file.
   */
  private sink(): Writable {
    return new Writable({
      write: (chunk: Buffer, _encoding, done) => {
        this.offset += chunk.length;
        if (this.out.write(chunk)) done();
        else this.out.once('drain', done);
      },
    });
  }
}

/** Counts and checksums what passes through it, and changes nothing. */
class Counter extends Transform {
  public crc = 0;
  public size = 0;

  public _transform(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null, data?: Buffer) => void): void {
    this.crc = crc32(chunk, this.crc);
    this.size += chunk.length;
    done(null, chunk);
  }
}

const localHeaderOf = (name: Buffer, method: number, dosTime: number, dosDate: number): Buffer => {
  const header = Buffer.alloc(30 + name.length + 20);
  header.writeUInt32LE(LOCAL_HEADER, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(FLAGS, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(dosTime, 10);
  header.writeUInt16LE(dosDate, 12);
  // The checksum and the two sizes stay zero here and are stated afterwards.
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(20, 28);
  name.copy(header, 30);
  // An empty Zip64 record, which is what makes the descriptor's sizes 64 bit.
  header.writeUInt16LE(ZIP64_TAG, 30 + name.length);
  header.writeUInt16LE(16, 32 + name.length);

  return header;
};

const descriptorOf = (crc: number, compressedSize: number, size: number): Buffer => {
  const descriptor = Buffer.alloc(DESCRIPTOR_LENGTH);
  descriptor.writeUInt32LE(DATA_DESCRIPTOR, 0);
  descriptor.writeUInt32LE(crc >>> 0, 4);
  descriptor.writeBigUInt64LE(BigInt(compressedSize), 8);
  descriptor.writeBigUInt64LE(BigInt(size), 16);

  return descriptor;
};

/**
 * One row of the directory. Its 32-bit fields hold the real numbers where they
 * fit and the Zip64 sentinel where they do not, with the wide values in the
 * extra field - so an ordinary archive still reads as an ordinary one.
 */
const centralEntryOf = (entry: DirectoryEntry): Buffer => {
  const wide = entry.size >= U32 || entry.compressedSize >= U32 || entry.offset >= U32;
  const extra = wide ? zip64ExtraOf(entry) : Buffer.alloc(0);
  const row = Buffer.alloc(46 + entry.name.length + extra.length);

  row.writeUInt32LE(CENTRAL_HEADER, 0);
  row.writeUInt16LE(VERSION, 4);
  row.writeUInt16LE(VERSION, 6);
  row.writeUInt16LE(FLAGS, 8);
  row.writeUInt16LE(entry.method, 10);
  row.writeUInt16LE(entry.dosTime, 12);
  row.writeUInt16LE(entry.dosDate, 14);
  row.writeUInt32LE(entry.crc >>> 0, 16);
  row.writeUInt32LE(wide ? U32 : entry.compressedSize, 20);
  row.writeUInt32LE(wide ? U32 : entry.size, 24);
  row.writeUInt16LE(entry.name.length, 28);
  row.writeUInt16LE(extra.length, 30);
  row.writeUInt32LE(wide ? U32 : entry.offset, 42);
  entry.name.copy(row, 46);
  extra.copy(row, 46 + entry.name.length);

  return row;
};

const zip64ExtraOf = (entry: DirectoryEntry): Buffer => {
  const extra = Buffer.alloc(28);
  extra.writeUInt16LE(ZIP64_TAG, 0);
  extra.writeUInt16LE(24, 2);
  extra.writeBigUInt64LE(BigInt(entry.size), 4);
  extra.writeBigUInt64LE(BigInt(entry.compressedSize), 12);
  extra.writeBigUInt64LE(BigInt(entry.offset), 20);

  return extra;
};

/**
 * The three records that close an archive. The Zip64 pair is always written -
 * it costs seventy-six bytes and a reader that does not understand it steps
 * over it - and the old record beside them carries a sentinel wherever the
 * truth no longer fits.
 */
const endOf = (count: number, length: number, offset: number): Buffer => {
  const end = Buffer.alloc(56 + 20 + 22);

  end.writeUInt32LE(ZIP64_END, 0);
  end.writeBigUInt64LE(BigInt(44), 4);
  end.writeUInt16LE(VERSION, 12);
  end.writeUInt16LE(VERSION, 14);
  end.writeBigUInt64LE(BigInt(count), 24);
  end.writeBigUInt64LE(BigInt(count), 32);
  end.writeBigUInt64LE(BigInt(length), 40);
  end.writeBigUInt64LE(BigInt(offset), 48);

  end.writeUInt32LE(ZIP64_LOCATOR, 56);
  end.writeBigUInt64LE(BigInt(offset + length), 64);
  end.writeUInt32LE(1, 72);

  end.writeUInt32LE(END_OF_DIRECTORY, 76);
  end.writeUInt16LE(Math.min(count, U16), 84);
  end.writeUInt16LE(Math.min(count, U16), 86);
  end.writeUInt32LE(Math.min(length, U32), 88);
  end.writeUInt32LE(Math.min(offset, U32), 92);

  return end;
};

/** The clock a zip entry carries: two-second resolution, and no time zone at all. */
const dosStamp = (at: Date): { dosTime: number; dosDate: number } => ({
  dosTime: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1),
  dosDate: ((Math.max(1980, at.getUTCFullYear()) - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
});
