"use strict";

// Minimal pure-JS PNG decode/resize/encode built on node's zlib. Supports the
// PNGs that realistically appear as APK launcher icons / user uploads:
// non-interlaced, 8-bit (or palette 1/2/4-bit) colour types 0,2,3,4,6.
// Used to regenerate the client's per-density ic_launcher.png files.

const zlib = require("zlib");

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

// Decode a PNG into indexed pixels { width, height, pixels: Uint8Array RGBA }.
function decode(buf) {
  if (buf.length < 8 || !buf.slice(0, 8).equals(SIG)) throw new Error("not a PNG");
  let pos = 8;
  let width = 0,
    height = 0,
    bitDepth = 0,
    colorType = 0,
    interlace = 0;
  const idat = [];
  let palette = null;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (!width || !height) throw new Error("PNG missing IHDR");
  if (interlace !== 0) throw new Error("interlaced PNG not supported");

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) throw new Error("unsupported PNG colour type " + colorType);
  const bpp = (bitDepth * channels) / 8 < 1 ? 1 : (bitDepth * channels) / 8;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rowLen = Math.ceil((width * bitDepth * channels) / 8);
  if (raw.length !== rowLen * height + height) throw new Error("PNG data size mismatch");

  const stride = width * 4;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(rowLen);
  for (let y = 0; y < height; y++) {
    const row = raw.slice(y * (rowLen + 1) + 1, (y + 1) * (rowLen + 1));
    const filter = raw[y * (rowLen + 1)];
    const cur = new Uint8Array(rowLen);
    for (let x = 0; x < rowLen; x++) {
      let v = row[x];
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 0xff;
      }
      cur[x] = v;
    }
    prev.set(cur);
    // expand to RGBA
    for (let x = 0; x < width; x++) {
      const o = y * stride + x * 4;
      if (colorType === 0) {
        const v = bitDepth === 8 ? cur[x] : bitDepth === 16 ? cur[x * 2] : sampleBit(cur, x * bitDepth, bitDepth, rowLen);
        out[o] = out[o + 1] = out[o + 2] = v;
        out[o + 3] = 255;
      } else if (colorType === 2) {
        out[o] = cur[x * 3];
        out[o + 1] = cur[x * 3 + 1];
        out[o + 2] = cur[x * 3 + 2];
        out[o + 3] = 255;
      } else if (colorType === 3) {
        const idx = sampleBit(cur, x * bitDepth, bitDepth, rowLen);
        out[o] = palette[idx * 3];
        out[o + 1] = palette[idx * 3 + 1];
        out[o + 2] = palette[idx * 3 + 2];
        out[o + 3] = 255;
      } else if (colorType === 4) {
        const g = cur[x * 2];
        out[o] = out[o + 1] = out[o + 2] = g;
        out[o + 3] = cur[x * 2 + 1];
      } else {
        out[o] = cur[x * 4];
        out[o + 1] = cur[x * 4 + 1];
        out[o + 2] = cur[x * 4 + 2];
        out[o + 3] = cur[x * 4 + 3];
      }
    }
  }
  return { width, height, pixels: out };
}

function sampleBit(row, bitPos, bitDepth, rowLen) {
  if (bitDepth === 8) return row[bitPos >> 3];
  const byte = row[bitPos >> 3];
  const shift = 8 - bitDepth - (bitPos & 7);
  const mask = (1 << bitDepth) - 1;
  const v = (byte >> shift) & mask;
  const max = (1 << bitDepth) - 1;
  return Math.round((v * 255) / max);
}

// Area-average (box) downscale + bilinear upscale to any target size.
function resize(img, nw, nh) {
  const { width: sw, height: sh, pixels } = img;
  if (nw === sw && nh === sh) return { width: nw, height: nh, pixels };
  const src = pixels;
  const out = new Uint8Array(nw * nh * 4);
  const sx = sw / nw;
  const sy = sh / nh;
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil((x + 1) * sx)));
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * sw + xx) * 4;
          r += src[o];
          g += src[o + 1];
          b += src[o + 2];
          a += src[o + 3];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * nw + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: nw, height: nh, pixels: out };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Pick a per-scanline filter using the standard minimum-sum-of-absolute-
// differences heuristic. Filtering type "None" for every row (what a naive
// encoder does) leaves the deflate stream far larger than necessary.
function filterRows(pixels, width, height, bpp) {
  const stride = width * bpp;
  const rowLen = stride + 1;
  const out = Buffer.alloc(rowLen * height);
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];

  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const prev = row - stride;
    let best = 0;
    let bestScore = Infinity;

    for (let f = 0; f < 5; f++) {
      const c = cand[f];
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const cur = pixels[row + x];
        const a = x >= bpp ? pixels[row + x - bpp] : 0;
        const b = y > 0 ? pixels[prev + x] : 0;
        const cc = y > 0 && x >= bpp ? pixels[prev + x - bpp] : 0;
        let v;
        if (f === 0) v = cur;
        else if (f === 1) v = cur - a;
        else if (f === 2) v = cur - b;
        else if (f === 3) v = cur - ((a + b) >> 1);
        else v = cur - paeth(a, b, cc);
        v &= 0xff;
        c[x] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }

    out[y * rowLen] = best;
    cand[best].copy(out, y * rowLen + 1);
  }
  return out;
}

function encode(img) {
  const { width, height, pixels } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(filterRows(pixels, width, height, 4), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Fit an arbitrary source image onto a square canvas of the target side
// (top-left anchored, transparent padding where needed), then size it there.
function squareOfSize(img, side) {
  const { width, height } = img;
  const side0 = Math.max(width, height);
  const fitted = resize(img, Math.round((width / side0) * side), Math.round((height / side0) * side));
  const out = new Uint8Array(side * side * 4);
  const offX = (side - fitted.width) >> 1;
  const offY = (side - fitted.height) >> 1;
  for (let y = 0; y < fitted.height; y++) {
    for (let x = 0; x < fitted.width; x++) {
      const s = (y * fitted.width + x) * 4;
      const d = ((offY + y) * side + offX + x) * 4;
      out[d] = fitted.pixels[s];
      out[d + 1] = fitted.pixels[s + 1];
      out[d + 2] = fitted.pixels[s + 2];
      out[d + 3] = fitted.pixels[s + 3];
    }
  }
  return { width: side, height: side, pixels: out };
}

module.exports = { decode, resize, encode, squareOfSize };