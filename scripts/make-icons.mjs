// Generates the PWA icons (PNG) without any image library:
// a teal rounded square with a white rising bar chart.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../client/public/icons");
fs.mkdirSync(outDir, { recursive: true });

const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function render(size, { padding = 0, radius = 0.22 }) {
  const px = Buffer.alloc(size * size * 4);
  const bg = [15, 118, 110]; // teal
  const bgDark = [13, 95, 89];
  const white = [255, 255, 255];
  const r = size * radius;
  const pad = size * padding;
  const inner = size - pad * 2;
  // bars: x positions and heights relative to inner box
  const bars = [
    [0.2, 0.3],
    [0.42, 0.5],
    [0.64, 0.72],
  ];
  const barW = inner * 0.16;
  const baseY = pad + inner * 0.8;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let color = null;
      // rounded square background
      const lx = x - pad, ly = y - pad;
      let inside = lx >= 0 && ly >= 0 && lx < inner && ly < inner;
      if (inside) {
        const cx = Math.min(Math.max(lx, r), inner - r);
        const cy = Math.min(Math.max(ly, r), inner - r);
        inside = (lx - cx) ** 2 + (ly - cy) ** 2 <= r * r;
      }
      if (inside) {
        const t = (lx + ly) / (2 * inner);
        color = bg.map((c, k) => Math.round(c * (1 - t) + bgDark[k] * t));
        for (const [bx, bh] of bars) {
          const x0 = pad + inner * bx, x1 = x0 + barW;
          const y0 = baseY - inner * bh * 0.6, y1 = baseY;
          if (x >= x0 && x < x1 && y >= y0 && y < y1) color = white;
        }
        // small upward arrow line across bar tops
        const ax0 = pad + inner * 0.2, ay0 = baseY - inner * 0.3 * 0.6 - inner * 0.09;
        const ax1 = pad + inner * 0.8, ay1 = baseY - inner * 0.72 * 0.6 - inner * 0.09;
        const tt = (x - ax0) / (ax1 - ax0);
        if (tt >= 0 && tt <= 1) {
          const ly2 = ay0 + (ay1 - ay0) * tt;
          if (Math.abs(y - ly2) < inner * 0.035) color = white;
        }
      }
      if (color) {
        px[i] = color[0]; px[i + 1] = color[1]; px[i + 2] = color[2]; px[i + 3] = 255;
      } else {
        px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0;
      }
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.writeFileSync(path.join(outDir, "icon-192.png"), render(192, { padding: 0 }));
fs.writeFileSync(path.join(outDir, "icon-512.png"), render(512, { padding: 0 }));
fs.writeFileSync(path.join(outDir, "apple-touch-icon.png"), render(180, { padding: 0, radius: 0 }));
console.log("icons written to", outDir);
