"use strict";

// Renames the app by rewriting `string/app_name` in resources.arsc.
// AndroidManifest.xml is never touched, so there is no AXML to get subtly
// wrong at install time.
//
// `string/app_name` (type 0x0b, entry 0xbe) exists once per locale, each
// pointing at a *different* value-pool string ("RetroRoyale", the Japanese
// name, the Korean name, ...). All of them are repointed at one new string,
// otherwise the rename would only stick on English devices.
//
// The new string is appended to the value pool, which grows the pool by one
// offset entry (4 bytes). Two things must move together, and getting this
// wrong silently corrupts the table:
//   - `stringsStart` advances by 4, so the string DATA must be copied to the
//     new position, not left where it was. Skip this and every existing
//     string reads 4 bytes late ("res/layout/x" -> "layout/x") and Android
//     refuses to install, even though the new name still reads back fine.
//   - the chunk is re-padded to a 4-byte boundary so the package chunk that
//     follows stays aligned, and the top-level table size is updated.
// Entries reference pool strings by index, never by byte offset, so no other
// bookkeeping changes.

const RES_STRING_POOL_TYPE = 0x0001;
const RES_TABLE_TYPE = 0x0002;
const RES_TABLE_TYPE_TYPE = 0x0201;
const RES_TABLE_LIBRARY_TYPE = 0x0203;
const FLAG_SPARSE = 0x01;

const APP_NAME_TYPE_ID = 0x0b;
const APP_NAME_ENTRY = 0xbe;

const pad4 = (n) => (n + 3) & ~3;

function decodePool(buf, off) {
  const count = buf.readUInt32LE(off + 8);
  const flags = buf.readUInt32LE(off + 16);
  const isUtf8 = (flags & 0x100) !== 0;
  const stringsStart = buf.readUInt32LE(off + 20);
  const strings = [];
  for (let i = 0; i < count; i++) {
    let p = off + stringsStart + buf.readUInt32LE(off + 28 + i * 4);
    let u16len = buf[p++];
    if (u16len & 0x80) u16len = ((u16len & 0x7f) << 8) | buf[p++];
    let len = buf[p++];
    if (len & 0x80) len = ((len & 0x7f) << 8) | buf[p++];
    strings.push(isUtf8 ? buf.toString("utf8", p, p + len) : buf.toString("utf16le", p, p + len * 2));
  }
  return { off, count, flags, isUtf8, stringsStart, strings };
}

// UTF-8 pool string: <u16 len><utf8 len><bytes><NUL>
function encodePoolString(s) {
  const out = [];
  const units = Array.from(s).reduce((n, c) => n + (c.codePointAt(0) > 0xffff ? 2 : 1), 0);
  const bytes = Buffer.from(s, "utf8");
  if (units >= 0x80 || bytes.length >= 0x80) {
    throw new Error("app name is too long (max 127 characters)");
  }
  const w = (v) => { if (v >= 0x80) out.push(0x80 | (v >> 8), v & 0xff); else out.push(v); };
  w(units);
  w(bytes.length);
  out.push(...Array.from(bytes), 0);
  return Buffer.from(out);
}

// Grow the value pool by one string. Keeps every existing string byte-identical.
function buildPoolWithString(buf, off, name) {
  const pool = decodePool(buf, off);
  if (!pool.isUtf8) throw new Error("unexpected UTF-16 resource value pool");
  const headerSize = buf.readUInt16LE(off + 2);
  const oldSize = buf.readUInt32LE(off + 4);
  const styleCount = buf.readUInt32LE(off + 12);
  const stylesStart = buf.readUInt32LE(off + 24);
  const oldData = buf.subarray(off + pool.stringsStart, off + oldSize);
  const encoded = encodePoolString(name);

  const newCount = pool.count + 1;
  // The offset table grew by 4 bytes, so the string data moves 4 bytes later.
  const newStringsStart = headerSize + 4 * newCount + 4 * styleCount;
  const newRelOffset = oldData.length;
  const out = Buffer.alloc(pad4(newStringsStart + oldData.length + encoded.length));

  out.writeUInt16LE(RES_STRING_POOL_TYPE, 0);
  out.writeUInt16LE(headerSize, 2);
  out.writeUInt32LE(out.length, 4);
  out.writeUInt32LE(newCount, 8);
  out.writeUInt32LE(styleCount, 12);
  out.writeUInt32LE(pool.flags, 16);
  out.writeUInt32LE(newStringsStart, 20);
  out.writeUInt32LE(stylesStart, 24);
  buf.copy(out, 28, off + 28, off + 28 + 4 * pool.count); // existing offsets
  out.writeUInt32LE(newRelOffset, 28 + 4 * pool.count); // the new string
  oldData.copy(out, newStringsStart); // data SHIFTED to match stringsStart
  encoded.copy(out, newStringsStart + newRelOffset);
  // tail padding stays zero

  return { pool: out, index: pool.count, oldSize };
}

// Every string/app_name value slot, one per locale config.
function findAppNameSlots(buf) {
  const valuePoolOff = buf.readUInt16LE(2);
  const valuePoolSize = buf.readUInt32LE(valuePoolOff + 4);
  const pkgOff = valuePoolOff + valuePoolSize;
  const pkgSize = buf.readUInt32LE(pkgOff + 4);
  const pkgHeaderSize = buf.readUInt16LE(pkgOff + 2);
  const pkgEnd = pkgOff + pkgSize;

  const typePool = decodePool(buf, pkgOff + buf.readUInt32LE(pkgOff + 12 + 256));
  const typeId = typePool.strings.indexOf("string") + 1;
  if (typeId !== APP_NAME_TYPE_ID) {
    throw new Error(`unexpected string typeId 0x${typeId.toString(16)} (expected 0x0b)`);
  }

  const slots = [];
  let off = pkgOff + pkgHeaderSize;
  let guard = 0;
  while (off + 8 <= pkgEnd && guard++ < 100000) {
    const type = buf.readUInt16LE(off);
    const headerSize = buf.readUInt16LE(off + 2);
    const size = buf.readUInt32LE(off + 4);
    if (size < 8 || off + size > pkgEnd) {
      throw new Error(`malformed resources.arsc chunk at 0x${off.toString(16)}`);
    }
    if (type === RES_TABLE_TYPE_TYPE || type === RES_TABLE_LIBRARY_TYPE) {
      if (buf.readUInt8(off + 8) === APP_NAME_TYPE_ID && APP_NAME_ENTRY < buf.readUInt32LE(off + 12)) {
        const rel = buf.readUInt32LE(off + headerSize + APP_NAME_ENTRY * 4);
        if (rel !== 0 && rel !== 0xffffffff) {
          const entryOff = off + buf.readUInt32LE(off + 16) + rel;
          if (buf.readUInt16LE(entryOff) === 8 && (buf.readUInt16LE(entryOff + 2) & 0x0001) === 0) {
            const valueOff = entryOff + 8;
            if (buf.readUInt8(valueOff + 3) === 0x03) {
              slots.push({ offset: valueOff + 4, previous: buf.readUInt32LE(valueOff + 4) });
            }
          }
        }
      }
    }
    off += size;
  }
  return { slots };
}

function setAppName(buf, name) {
  if (!name || !name.trim()) throw new Error("app name is empty");
  if (buf.readUInt16LE(0) !== RES_TABLE_TYPE) throw new Error("not a resources.arsc table");

  const { slots } = findAppNameSlots(buf);
  if (!slots.length) throw new Error("string/app_name not found in resources.arsc");

  const topHeaderSize = buf.readUInt16LE(2);
  const { pool, index, oldSize } = buildPoolWithString(buf, topHeaderSize, name.trim());
  const tail = buf.subarray(topHeaderSize + oldSize);
  const out = Buffer.concat([buf.subarray(0, topHeaderSize), pool, tail]);

  // The pool grew, so every chunk after it shifted. Chunk sizes are relative
  // to their own start, so only the top-level table size needs updating.
  const delta = pool.length - oldSize;
  out.writeUInt32LE(out.length, 4);
  for (const slot of slots) out.writeUInt32LE(index, slot.offset + delta);

  return { buffer: out, configs: slots.length, stringIndex: index };
}

function getAppNames(buf) {
  const valuePoolOff = buf.readUInt16LE(2);
  const pool = decodePool(buf, valuePoolOff);
  return findAppNameSlots(buf).slots.map((s) => pool.strings[s.previous]);
}

module.exports = { setAppName, getAppNames, findAppNameSlots, decodePool, buildPoolWithString, APP_NAME_TYPE_ID, APP_NAME_ENTRY };
