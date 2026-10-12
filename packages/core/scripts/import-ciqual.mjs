/**
 * Importe les valeurs nutritionnelles du catalogue depuis la table Ciqual (ANSES, Licence Ouverte).
 *
 *   npm run ciqual -w @bouffe/core                    télécharge l'archive officielle
 *   npm run ciqual -w @bouffe/core -- chemin/vers.zip utilise une archive déjà téléchargée
 *
 * Le script lit l'archive XML publiée par l'ANSES, retient pour chaque aliment du catalogue l'aliment
 * de référence désigné dans MAPPING (à l'état cru quand l'aliment s'achète cru) et écrit
 * `src/data/ciqual.ts`. Ce fichier généré est versionné : l'application ne télécharge rien.
 *
 * Aucune dépendance : lecture du zip et du XML avec les modules standard de Node.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const SOURCE = {
  name: 'Table de composition nutritionnelle des aliments Ciqual 2020',
  publisher: 'Anses',
  version: '2020-07-07',
  license: 'Licence Ouverte / Open Licence (Etalab)',
  url: 'https://ciqual.anses.fr/',
  archive: 'https://ciqual.anses.fr/cms/sites/default/files/inline-files/XML_2020_07_07.zip',
};
const FILES = { alim: 'alim_2020_07_07.xml', compo: 'compo_2020_07_07.xml' };

/** Aliment du catalogue → code de l'aliment de référence dans la table. */
const MAPPING = {
  poulet: { code: '36017' },
  dinde: { code: '36304' },
  'steak-hache-5': { code: '6250' },
  rumsteck: { code: '6206' },
  'haut-de-cuisse-poulet': { code: '36019', note: 'Viande seule, sans la peau.' },
  oeufs: { code: '22000' },
  saumon: { code: '26036' },
  'poisson-blanc': { code: '26043' },
  thon: { code: '26039' },
  'blanc-poulet-tranches': { code: '28963' },
  'allumettes-poulet': { code: '28929' },
  riz: { code: '9119' },
  pates: { code: '9810' },
  'pates-completes': { code: '9870' },
  semoule: { code: '9681' },
  'pommes-de-terre': { code: '4008' },
  gnocchis: { code: '26264' },
  'pain-complet': { code: '7111' },
  'pain-burger': { code: '7262' },
  wrap: { code: '7815', note: 'Tortilla de blé : la table ne distingue pas la version au blé complet.' },
  chapelure: { code: '7500' },
  'flocons-avoine': { code: '9311' },
  'fromage-blanc': { code: '19644' },
  yaourt: { code: '19593' },
  lait: { code: '19041' },
  beurre: { code: '16400' },
  parmesan: { code: '12120' },
  emmental: { code: '12118' },
  mozzarella: { code: '19590' },
  cheddar: { code: '12726' },
  'creme-legere': { code: '19431' },
  banane: { code: '13005' },
  pomme: { code: '13039' },
  clementine: { code: '13024' },
  kiwi: { code: '13021' },
  poire: { code: '13037' },
  'fruits-rouges': { code: '13997', note: 'Mélange de fruits rouges crus (framboises, fraises, groseilles, cassis).' },
  compote: { code: '13153' },
  'compote-gourde': { code: '13153' },
  'huile-olive': { code: '17270' },
  'sauce-tomate': { code: '20260' },
  'sauce-soja': { code: '11104' },
  ketchup: { code: '11008' },
  moutarde: { code: '11013' },
  pesto: { code: '11179' },
  miel: { code: '31008' },
  amandes: { code: '15000' },
  noix: { code: '15005' },
  'beurre-cacahuete': { code: '15202' },
  'paprika-fume': { code: '11049', note: 'Paprika : la table ne distingue pas la version fumée.' },
  'curry-poudre': { code: '11005' },
  'herbes-provence': { code: '11060' },
  'jus-citron': { code: '2028' },
};

/** Aliments du catalogue sans équivalent dans la table : ils gardent une valeur moyenne d'étiquettes. */
const MISSING = {
  skyr: 'Absent de la table Ciqual 2020.',
  'boisson-proteinee': 'Produit de marque, absent de la table.',
  whey: 'Complément alimentaire, absent de la table.',
  'barre-proteinee': 'Produit de marque, absent de la table.',
  'fromage-frais': 'La table ne contient pas de fromage à tartiner allégé.',
  'poulet-roti-eminces': 'La table ne contient que du poulet rôti entier, avec la peau.',
  'epices-cajun': "Mélange d'épices, absent de la table.",
  'epices-tex-mex': "Mélange d'épices, absent de la table.",
  'epices-tandoori': "Mélange d'épices, absent de la table.",
  'ail-persil': "Mélange, absent de la table : moyenne de l'ail séché et du persil séché qui y figurent.",
};

// ───────────── Lecture de l'archive ─────────────

/** Lecteur zip minimal : répertoire central, fichiers stockés ou compressés en « deflate ». */
function unzip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("Archive illisible : ce fichier n'est pas un zip.");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Archive illisible : répertoire central corrompu.');
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`Archive : compression non prise en charge pour ${name}.`);
    files.set(name, () => (method === 0 ? data : inflateRawSync(data)));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

async function loadArchive(path) {
  if (path) return readFileSync(path);
  console.log(`Téléchargement de ${SOURCE.archive}`);
  const response = await fetch(SOURCE.archive);
  if (!response.ok) throw new Error(`Téléchargement impossible (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

const archive = await loadArchive(process.argv[2]);
const files = unzip(archive);
const text = (name) => {
  const read = files.get(name);
  if (!read) throw new Error(`Fichier ${name} absent de l'archive.`);
  // Les fichiers de l'Anses sont encodés en windows-1252.
  return new TextDecoder('windows-1252').decode(read());
};

// ───────────── Lecture de la table ─────────────

const names = new Map();
for (const [, code, name] of text(FILES.alim).matchAll(/<alim_code>\s*(\d+)\s*<\/alim_code>\s*<alim_nom_fr>([\s\S]*?)<\/alim_nom_fr>/g)) {
  names.set(code, name.trim().replace(/&amp;/g, '&'));
}

/** Constituants utiles (codes de la table). Les protéines sont celles de l'étiquetage : N × 6,25. */
const CONSTITUENTS = { 328: 'kcal', 25003: 'protein', 25000: 'proteinJones', 31000: 'carbs', 40000: 'fat', 34100: 'fiber', 34000: 'polyols', 60000: 'alcohol', 65000: 'acids' };
const wanted = new Set(Object.values(MAPPING).map((m) => m.code));

/**
 * « 12,5 » → 12.5 ; « traces » → 0 ; « < 0,5 » (sous le seuil de mesure) → la moitié du seuil ;
 * « - » (non mesuré) → null.
 */
function parseValue(raw) {
  const value = raw.replace(/&lt;/g, '<').trim();
  if (value === '' || value === '-') return null;
  if (/^traces?$/i.test(value)) return { value: 0, below: true };
  const below = value.startsWith('<');
  const number = Number(value.replace('<', '').trim().replace(',', '.'));
  if (!Number.isFinite(number)) return null;
  return { value: below ? number / 2 : number, below };
}

const table = new Map();
const all = new Map();
for (const [, code, constituent, raw] of text(FILES.compo).matchAll(/<alim_code>\s*(\d+)\s*<\/alim_code>\s*<const_code>\s*(\d+)\s*<\/const_code>\s*<teneur>([\s\S]*?)<\/teneur>/g)) {
  const key = CONSTITUENTS[constituent];
  if (!key) continue;
  const parsed = parseValue(raw);
  if (!parsed) continue;
  const target = wanted.has(code) ? table : all;
  const entry = target.get(code) ?? {};
  // Sous le seuil de mesure, des fibres ne sont pas comptées (viande, huile, fromage…).
  entry[key] = key === 'fiber' && parsed.below ? 0 : parsed.value;
  target.set(code, entry);
}

/** Énergie selon l'annexe XIV du règlement (UE) n° 1169/2011, pour les aliments dont la table ne la donne pas. */
function energy(v) {
  return 4 * v.protein + 4 * v.carbs + 9 * v.fat + 2 * (v.fiber ?? 0) + 2.4 * (v.polyols ?? 0) + 7 * (v.alcohol ?? 0) + 3 * (v.acids ?? 0);
}

// Contrôle : sur les aliments où la table fournit l'énergie, le calcul doit la retrouver.
const gaps = [];
for (const v of [...all.values(), ...table.values()]) {
  v.protein ??= v.proteinJones;
  if (v.kcal === undefined || v.protein === undefined || v.carbs === undefined || v.fat === undefined || v.kcal < 20) continue;
  gaps.push(Math.abs(energy(v) - v.kcal) / v.kcal);
}
gaps.sort((a, b) => a - b);
const median = gaps[Math.floor(gaps.length / 2)];
console.log(`Contrôle du calcul d'énergie sur ${gaps.length} aliments : écart médian ${(median * 100).toFixed(1)} %, 90e centile ${(gaps[Math.floor(gaps.length * 0.9)] * 100).toFixed(1)} %.`);
if (median > 0.03) throw new Error("Le calcul d'énergie ne retrouve pas les valeurs de la table : import interrompu.");

// ───────────── Écriture ─────────────

const round1 = (value) => Math.round(value * 10) / 10;
/** Chaîne TypeScript au style du dépôt : apostrophes, sauf si le texte en contient. */
const quote = (value) => (/['\\]/.test(value) ? JSON.stringify(value) : `'${value}'`);
const property = (value) => (/^[a-z_$][\w$]*$/i.test(value) ? value : quote(value));
const lines = [];
let computed = 0;
for (const [foodId, { code, note }] of Object.entries(MAPPING)) {
  const v = table.get(code);
  const label = names.get(code);
  if (!v || !label) throw new Error(`Aliment ${code} (${foodId}) introuvable dans la table.`);
  v.protein ??= v.proteinJones;
  for (const key of ['protein', 'carbs', 'fat']) {
    if (v[key] === undefined) throw new Error(`${label} (${code}) : ${key} absent de la table.`);
  }
  const energyComputed = v.kcal === undefined;
  if (energyComputed) computed++;
  const per100 = {
    kcal: Math.round(energyComputed ? energy(v) : v.kcal),
    protein: round1(v.protein),
    carbs: round1(v.carbs),
    fat: round1(v.fat),
    fiber: round1(v.fiber ?? 0),
  };
  const fields = [
    `code: '${code}'`,
    `label: ${quote(label)}`,
    `per100: { kcal: ${per100.kcal}, protein: ${per100.protein}, carbs: ${per100.carbs}, fat: ${per100.fat}, fiber: ${per100.fiber} }`,
    ...(energyComputed ? ['energyComputed: true'] : []),
    ...(note ? [`note: ${quote(note)}`] : []),
  ];
  lines.push(`  ${property(foodId)}: { ${fields.join(', ')} },`);
}

const output = `/**
 * Valeurs nutritionnelles de référence du catalogue, issues de la table Ciqual (Anses).
 *
 * FICHIER GÉNÉRÉ par \`npm run ciqual -w @bouffe/core\` (scripts/import-ciqual.mjs) — ne pas modifier
 * à la main : changer la correspondance dans le script, puis relancer l'import.
 *
 * Source : ${SOURCE.name}, ${SOURCE.publisher}, version du ${SOURCE.version}.
 * ${SOURCE.url} — ${SOURCE.license}.
 * Valeurs pour 100 g de produit tel qu'acheté (cru pour les viandes, poissons et féculents).
 * Protéines : azote × 6,25, comme sur les étiquettes.
 */
import type { Nutrients } from '../types.js';

export const CIQUAL_SOURCE = {
  name: ${quote(SOURCE.name)},
  publisher: ${quote(SOURCE.publisher)},
  version: ${quote(SOURCE.version)},
  license: ${quote(SOURCE.license)},
  url: ${quote(SOURCE.url)},
} as const;

export interface CiqualValue {
  /** Code de l'aliment de référence dans la table. */
  code: string;
  /** Libellé officiel de cet aliment. */
  label: string;
  per100: Nutrients;
  /**
   * La table ne donne pas l'énergie de cet aliment : elle est calculée à partir de ses
   * macronutriments, avec les coefficients du règlement (UE) n° 1169/2011.
   */
  energyComputed?: true;
  /** Écart connu entre l'aliment du catalogue et l'aliment de référence. */
  note?: string;
}

/** Aliment du catalogue → valeurs de la table. */
export const CIQUAL_VALUES: Record<string, CiqualValue> = {
${lines.join('\n')}
};

/**
 * Aliments du catalogue sans équivalent dans la table : ils gardent une valeur moyenne relevée sur
 * des étiquettes, à remplacer par celle de ton produit (« Mes vrais produits »).
 */
export const CIQUAL_MISSING: Record<string, string> = {
${Object.entries(MISSING)
  .map(([id, reason]) => `  ${property(id)}: ${quote(reason)},`)
  .join('\n')}
};
`;

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'ciqual.ts');
writeFileSync(target, output);
console.log(`${lines.length} aliments écrits dans ${target} (${computed} avec énergie calculée, ${Object.keys(MISSING).length} sans équivalent).`);
