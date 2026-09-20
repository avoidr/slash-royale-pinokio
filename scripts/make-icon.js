"use strict";

// Generates icon.png (256x256, Clash Royale-style crest) with zero dependencies.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const W = 256;
const H = 256;
const px = Buffer.alloc(W * H * 4);

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const na = a / 255;
  px[i] = Math.round(px[i] * (1 - na) + r * na);
  px[i + 1] = Math.round(px[i + 1] * (1 - na) + g * na);
  px[i + 2] = Math.round(px[i + 2] * (1 - na) + b * na);
  px[i + 3] = 255;
}

function fillRect(x0, y0, x1, y1, color, aa = 1) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      blend(x, y, color[0], color[1], color[2], color[3] * aa);
    }
  }
}

// point-in-polygon
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function fillPoly(pts, color) {
  const minX = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0]))));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(...pts.map((p) => p[0]))));
  const minY = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1]))));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(...pts.map((p) => p[1]))));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (inPoly(x + 0.5, y + 0.5, pts)) blend(x, y, color[0], color[1], color[2], color[3]);
    }
  }
}

// rounded-rect mask
function inRoundedRect(x, y, rx, ry, rad) {
  if (x < rx || x > rx + W - 2 * rx || y < ry || y > ry + H - 2 * ry) {
    const cx = x < rx + rad ? rx + rad : x > rx + W - rad - 1 ? rx + W - rad - 1 : x;
    const cy = y < ry + rad ? ry + rad : y > ry + H - rad - 1 ? ry + H - rad - 1 : y;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= rad * rad;
  }
  return true;
}

// gradient navy background with rounded corners
const rad = 44;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (inRoundedRect(x, y, 0, 0, rad)) {
      const t = y / H;
      const r = Math.round(0x1a + (0x0d - 0x1a) * t);
      const g = Math.round(0x30 + (0x1c - 0x30) * t);
      const b = Math.round(0x52 + (0x3d - 0x52) * t);
      px[(y * W + x) * 4] = r;
      px[(y * W + x) * 4 + 1] = g;
      px[(y * W + x) * 4 + 2] = b;
      px[(y * W + x) * 4 + 3] = 255;
    }
  }
}

// inner border ring (darker)
const gold = [242, 201, 76, 255];
const goldDark = [185, 138, 31, 255];
const goldLight = [255, 236, 150, 255];
const stroke = 7;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const inner = inRoundedRect(x, y, 14, 14, 36);
    const outer = inRoundedRect(x, y, 20, 20, 34);
    if (inner && !outer) blend(x, y, goldDark[0], goldDark[1], goldDark[2], goldDark[3]);
  }
}

// crown band
const bandY0 = 138;
const bandY1 = 176;
fillRect(56, bandY0, 200, bandY1, gold);
fillRect(50, 168, 206, 182, goldDark);
// band gems
fillRect(84, 146, 96, 168, [220, 60, 60, 255]);
fillRect(160, 146, 172, 168, [74, 144, 226, 255]);

// crown spikes
fillPoly([[66, 138], [70, 74], [96, 138]], gold);
fillPoly([[104, 138], [112, 58], [144, 138]], gold);
fillPoly([[160, 138], [186, 74], [190, 138]], gold);
// spike tips highlight
fillPoly([[70, 74], [73, 96], [82, 98]], goldLight);
fillPoly([[112, 58], [117, 90], [127, 92]], goldLight);

// underline bar
fillRect(40, 196, 216, 206, goldDark);

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(__dirname, "..", "icon.png");
fs.writeFileSync(out, png);
console.log("wrote", out, png.length, "bytes");