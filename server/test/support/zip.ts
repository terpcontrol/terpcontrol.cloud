import { crc32, inflateRawSync } from 'node:zlib';

/**
 * Reading an export back, for the specs that care what is inside one.
 *
 * The server writes its own archives - there is no zip library in it - so a
 * spec cannot hand the file to a package and be sure the two agree. It walks
 * the directory at the end of the file the way any reader does, which is also
 * what checks that the headers at the front and the directory behind them say
 * the same thing, and it holds every entry to its checksum.
 *
 * Only what the writer produces is understood: Zip64 throughout, stored or
 * deflated, with the sizes in a descriptor after each entry rather than in its
 * header.
 */
export const unzip = (archive: Buffer): Map<string, Buffer> => {
  if (archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) < 0) throw new Error('That is not an archive: it has no end of directory');

  const zip64 = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
  if (zip64 < 0) throw new Error('That is not an archive this reader knows: it has no Zip64 directory');

  const count = Number(archive.readBigUInt64LE(zip64 + 32));
  let at = Number(archive.readBigUInt64LE(zip64 + 48));

  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(at) !== 0x02014b50) throw new Error(`Entry ${index} of the directory is not a directory header`);

    const method = archive.readUInt16LE(at + 10);
    const crc = archive.readUInt32LE(at + 16);
    const compressedSize = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const offset = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');

    // Where the bytes start: past the local header and whatever it carries.
    const from = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
    const stored = archive.subarray(from, from + compressedSize);
    const content = method === 8 ? inflateRawSync(stored) : stored;
    if (crc32(content) >>> 0 !== crc) throw new Error(`${name} does not match its checksum`);

    // The descriptor that follows the bytes says what the directory says. A
    // reader going forwards through the file has only that one to go by.
    const descriptor = from + compressedSize;
    if (
      archive.readUInt32LE(descriptor) !== 0x08074b50 ||
      archive.readUInt32LE(descriptor + 4) !== crc ||
      Number(archive.readBigUInt64LE(descriptor + 8)) !== compressedSize ||
      Number(archive.readBigUInt64LE(descriptor + 16)) !== content.length
    ) {
      throw new Error(`The descriptor behind ${name} does not say what the directory says`);
    }

    files.set(name, content);
    at += 46 + nameLength + extraLength;
  }

  return files;
};

/** Every archive entry as one string, for asking whether something is anywhere in it at all. */
export const everythingIn = (files: Map<string, Buffer>): string =>
  [...files.entries()].map(([name, body]) => `${name}\n${body.toString('utf8')}`).join('\n');
