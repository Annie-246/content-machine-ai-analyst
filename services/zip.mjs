// Đóng gói file thành .zip ngay trong trình duyệt.
//
// Written by hand rather than pulled from a library. A ZIP archive is a header
// per file, the bytes, and a table of contents at the end - the only hard part
// is DEFLATE, and the browser already ships that as CompressionStream. JSZip
// would add ~100KB to the bundle to do the same thing.
//
// Plain .mjs so it can be exercised by `node --test` against a real unzip tool,
// the same way the Radar maths is tested.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export const crc32 = (data) => {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

/** DEFLATE via the platform. Without it, entries are stored uncompressed. */
const deflateRaw = async (data) => {
  if (typeof CompressionStream === 'undefined' || data.length === 0) return { bytes: data, method: 0 };
  try {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer());
    // Small or already-compressed input can come out bigger; keep the smaller.
    return packed.length < data.length ? { bytes: packed, method: 8 } : { bytes: data, method: 0 };
  } catch {
    return { bytes: data, method: 0 };
  }
};

const dosDateTime = (date) => ({
  time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
});

/**
 * @param {{name: string, data: Uint8Array}[]} files
 * @returns {Promise<Blob>} a standard archive: local headers, then a central directory.
 *
 * Bit 11 of the general purpose flag marks names as UTF-8, which is what keeps
 * Vietnamese filenames intact when the archive is opened on Windows.
 */
export const zipFiles = async (files) => {
  const encoder = new TextEncoder();
  const stamp = dosDateTime(new Date());

  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);
    const { bytes, method } = await deflateRaw(file.data);

    const header = new Uint8Array(30 + nameBytes.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x04034b50, true);
    hv.setUint16(4, 20, true);      // version needed to extract
    hv.setUint16(6, 0x0800, true);  // UTF-8 names
    hv.setUint16(8, method, true);
    hv.setUint16(10, stamp.time, true);
    hv.setUint16(12, stamp.date, true);
    hv.setUint32(14, crc, true);
    hv.setUint32(18, bytes.length, true);
    hv.setUint32(22, file.data.length, true);
    hv.setUint16(26, nameBytes.length, true);
    hv.setUint16(28, 0, true);      // no extra field
    header.set(nameBytes, 30);

    parts.push(header, bytes);

    const entry = new Uint8Array(46 + nameBytes.length);
    const ev = new DataView(entry.buffer);
    ev.setUint32(0, 0x02014b50, true);
    ev.setUint16(4, 20, true);      // version made by
    ev.setUint16(6, 20, true);      // version needed
    ev.setUint16(8, 0x0800, true);
    ev.setUint16(10, method, true);
    ev.setUint16(12, stamp.time, true);
    ev.setUint16(14, stamp.date, true);
    ev.setUint32(16, crc, true);
    ev.setUint32(20, bytes.length, true);
    ev.setUint32(24, file.data.length, true);
    ev.setUint16(28, nameBytes.length, true);
    ev.setUint32(42, offset, true); // where this file's local header starts
    entry.set(nameBytes, 46);
    central.push(entry);

    offset += header.length + bytes.length;
  }

  const centralSize = central.reduce((sum, e) => sum + e.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], { type: 'application/zip' });
};
