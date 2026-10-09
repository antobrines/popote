/**
 * Génère les icônes PNG de la PWA sans dépendance (encodeur PNG minimal + zlib).
 * Motif : anneau de progression blanc sur fond vert, avec un point central.
 *
 *   node scripts/generate-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 3; // suréchantillonnage pour l'anticrénelage
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [pr, pg, pb, pa] = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
        }
      }
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      const n = SS * SS;
      raw[offset] = a ? Math.round(r / a) : 0;
      raw[offset + 1] = a ? Math.round(g / a) : 0;
      raw[offset + 2] = a ? Math.round(b / a) : 0;
      raw[offset + 3] = Math.round((a / n) * 255);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** @param {number} radius rayon des coins (0 = plein cadre) @param {number} scale taille du motif */
function icon(radius, scale) {
  return (u, v) => {
    // Fond : carré arrondi avec dégradé vertical.
    const dx = Math.max(Math.abs(u - 0.5) - (0.5 - radius), 0);
    const dy = Math.max(Math.abs(v - 0.5) - (0.5 - radius), 0);
    if (radius > 0 && Math.hypot(dx, dy) > radius) return [0, 0, 0, 0];
    const t = v;
    const bg = [Math.round(22 + (9 - 22) * t), Math.round(184 + (140 - 184) * t), Math.round(125 + (96 - 125) * t), 1];

    const x = (u - 0.5) / scale;
    const y = (v - 0.5) / scale;
    const dist = Math.hypot(x, y);
    // Anneau ouvert en haut à droite (progression ~78 %).
    const angle = (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI);
    const onRing = Math.abs(dist - 0.3) < 0.055 && angle < 2 * Math.PI * 0.78;
    const cap = (a) => Math.hypot(x - 0.3 * Math.sin(a), y + 0.3 * Math.cos(a)) < 0.055;
    if (onRing || cap(0) || cap(2 * Math.PI * 0.78)) return [255, 255, 255, 1];
    if (Math.abs(dist - 0.3) < 0.055) return [255, 255, 255, 0.28];
    if (dist < 0.105) return [255, 255, 255, 1];
    return bg;
  };
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, icon(0.22, 1)));
writeFileSync('public/icons/icon-512.png', png(512, icon(0.22, 1)));
writeFileSync('public/icons/icon-maskable-512.png', png(512, icon(0, 0.72)));
writeFileSync('public/icons/apple-touch-icon.png', png(180, icon(0, 0.9)));
console.log('Icônes générées dans public/icons');
