// Generates the Recallo app icons (180, 192, 512 px) as plain PNG files,
// using only Node's built-in zlib — no image library needed.
//
// The mark is two fanned, overlapping flashcards (not a flat stack) with
// a checkmark on the front card, for "you got it right" — rendered with
// 4x supersampling so the rotated edges stay smooth at every size.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');
// 180: iOS apple-touch-icon. The rest match the PWA manifest's icon list.
const SIZES = [72, 96, 128, 144, 152, 180, 192, 384, 512];
const SUPERSAMPLE = 4;

const BG = [0x3a, 0x6d, 0xf0]; // --color-primary
const BACK_CARD = [0xaf, 0xc5, 0xfb]; // light tint of the brand blue
const FRONT_CARD = [0xff, 0xff, 0xff];
const CHECK = [0x2f, 0xa8, 0x4f]; // --color-good — "correct" green

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** Is local point (x,y) — already centered on the rect — inside a centered rounded rect? */
function inCenteredRoundedRect(x, y, halfW, halfH, radius) {
  if (x < -halfW || x >= halfW || y < -halfH || y >= halfH) return false;
  const left = x < -halfW + radius;
  const right = x >= halfW - radius;
  const top = y < -halfH + radius;
  const bottom = y >= halfH - radius;
  if ((left || right) && (top || bottom)) {
    const cx = left ? -halfW + radius : halfW - radius;
    const cy = top ? -halfH + radius : halfH - radius;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  }
  return true;
}

/** Shortest distance from point (x,y) to the segment a->b. */
function distToSegment(x, y, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq > 0 ? ((x - ax) * abx + (y - ay) * aby) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * abx;
  const py = ay + t * aby;
  return Math.hypot(x - px, y - py);
}

/**
 * A rotated card: given a global point, returns its position in the
 * card's own centered, unrotated local frame (so membership/checkmark
 * tests stay simple axis-aligned math).
 */
function toLocal(x, y, cx, cy, angleDeg) {
  const rad = (-angleDeg * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: dx * Math.cos(rad) - dy * Math.sin(rad),
    y: dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

function renderIconHiRes(size) {
  const W = size * SUPERSAMPLE;
  const pixels = Buffer.alloc(W * W * 3);
  const setPixel = (x, y, color) => {
    const idx = (y * W + x) * 3;
    pixels[idx] = color[0];
    pixels[idx + 1] = color[1];
    pixels[idx + 2] = color[2];
  };

  const cardHalf = W * 0.27;
  const radius = cardHalf * 0.32;

  const backCx = W * 0.47;
  const backCy = W * 0.46;
  const backAngle = -11;

  const frontCx = W * 0.53;
  const frontCy = W * 0.56;
  const frontAngle = 9;

  // Checkmark, defined in the front card's local (centered) coordinates.
  const c1 = { x: -cardHalf * 0.42, y: cardHalf * 0.02 };
  const c2 = { x: -cardHalf * 0.08, y: cardHalf * 0.38 };
  const c3 = { x: cardHalf * 0.5, y: -cardHalf * 0.34 };
  const checkThickness = cardHalf * 0.16;

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let color = BG;

      const back = toLocal(x, y, backCx, backCy, backAngle);
      if (inCenteredRoundedRect(back.x, back.y, cardHalf, cardHalf, radius)) {
        color = BACK_CARD;
      }

      const front = toLocal(x, y, frontCx, frontCy, frontAngle);
      if (inCenteredRoundedRect(front.x, front.y, cardHalf, cardHalf, radius)) {
        color = FRONT_CARD;
        const d1 = distToSegment(front.x, front.y, c1.x, c1.y, c2.x, c2.y);
        const d2 = distToSegment(front.x, front.y, c2.x, c2.y, c3.x, c3.y);
        if (d1 <= checkThickness / 2 || d2 <= checkThickness / 2) {
          color = CHECK;
        }
      }

      setPixel(x, y, color);
    }
  }
  return pixels;
}

/** Downsamples a SUPERSAMPLE x oversized RGB buffer to `size` by averaging blocks. */
function downsample(hiRes, size) {
  const W = size * SUPERSAMPLE;
  const out = Buffer.alloc(size * size * 3);
  const blockPixels = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const idx = ((y * SUPERSAMPLE + sy) * W + (x * SUPERSAMPLE + sx)) * 3;
          r += hiRes[idx];
          g += hiRes[idx + 1];
          b += hiRes[idx + 2];
        }
      }
      const outIdx = (y * size + x) * 3;
      out[outIdx] = Math.round(r / blockPixels);
      out[outIdx + 1] = Math.round(g / blockPixels);
      out[outIdx + 2] = Math.round(b / blockPixels);
    }
  }
  return out;
}

function renderIcon(size) {
  return downsample(renderIconHiRes(size), size);
}

function encodePng(size, rgbPixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowBytes = size * 3;
  const raw = Buffer.alloc((rowBytes + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter: none
    rgbPixels.copy(raw, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Builds a .ico file from several PNG-encoded images (the modern, widely-supported ICO form). */
function encodeIco(pngsBySize) {
  const count = pngsBySize.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  const images = [];
  let offset = 6 + count * 16;
  for (const { size, png } of pngsBySize) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    images.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(size, renderIcon(size));
  const file = path.join(OUT_DIR, `icon-${size}x${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`Wrote ${file}`);
}

const FAVICON_SIZES = [16, 32, 48];
const favicon = encodeIco(FAVICON_SIZES.map((size) => ({ size, png: encodePng(size, renderIcon(size)) })));
const faviconPath = path.join(__dirname, '..', 'public', 'favicon.ico');
fs.writeFileSync(faviconPath, favicon);
console.log(`Wrote ${faviconPath}`);
