// Generates the PWA icons (PNG) without any image library:
// an indigo rounded square (the app accent) with a white wallet, a card peeking out
// and a lavender clasp. Edges are anti-aliased with 4x4 supersampling.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../client/public/icons");
fs.mkdirSync(outDir, { recursive: true });

// ---------- PNG writer ----------
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
function png(size, px) {
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
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- tiny vector helpers (unit coordinates, 0..1) ----------
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
/** Signed distance to a rounded rectangle centred at (cx, cy) with half sizes (hw, hh) and corner radius r. */
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - (hw - r), dy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}
const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

const INDIGO_1 = hex("#5b54f0"); // accent, lighter (top-left)
const INDIGO_2 = hex("#3b33b8"); // accent, deeper (bottom-right)
const WHITE = hex("#ffffff");
const LAVENDER = hex("#c9c5ff");
const INK = hex("#2e2a8f");

/** Returns [r, g, b, a] for one sample point, or null outside the tile. */
function shade(x, y, { radius, full }) {
  // Tile background: rounded square (or full bleed for the iOS icon, which iOS masks itself).
  const tile = full ? -1 : sdRoundRect(x, y, 0.5, 0.5, 0.5, 0.5, radius);
  if (tile > 0) return null;
  let color = mix(INDIGO_1, INDIGO_2, Math.min(1, Math.max(0, (x + y) / 2)));

  // Layers, back to front: card peeking out, wallet body, clasp, clasp button.
  const layers = [
    [sdRoundRect(x, y, 0.5, 0.33, 0.25, 0.07, 0.035), LAVENDER],
    [sdRoundRect(x, y, 0.5, 0.54, 0.31, 0.21, 0.075), WHITE],
    [sdRoundRect(x, y, 0.72, 0.56, 0.13, 0.085, 0.045), LAVENDER],
    [sdCircle(x, y, 0.735, 0.56, 0.036), INK],
  ];
  for (const [d, c] of layers) if (d <= 0) color = c;
  return color;
}

function render(size, opts) {
  const SS = 4; // supersampling grid per pixel
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, opts);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; n++;
        }
      }
      const i = (y * size + x) * 4;
      if (n === 0) { px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0; continue; }
      // Premultiplied average → straight alpha.
      px[i] = Math.round(r / n); px[i + 1] = Math.round(g / n); px[i + 2] = Math.round(b / n);
      px[i + 3] = Math.round((255 * n) / (SS * SS));
    }
  }
  return png(size, px);
}

fs.writeFileSync(path.join(outDir, "icon-192.png"), render(192, { radius: 0.22 }));
fs.writeFileSync(path.join(outDir, "icon-512.png"), render(512, { radius: 0.22 }));
fs.writeFileSync(path.join(outDir, "apple-touch-icon.png"), render(180, { full: true }));
console.log("icons written to", outDir);
