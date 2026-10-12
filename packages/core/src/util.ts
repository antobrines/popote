/** Générateur pseudo-aléatoire déterministe (mulberry32) : même graine → même programme. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(list: readonly T[]): T {
    return list[this.int(list.length)]!;
  }

  /** Tirage pondéré ; les poids ≤ 0 sont ignorés. */
  weighted<T>(list: readonly T[], weight: (item: T) => number): T {
    const weights = list.map((item) => Math.max(0, weight(item)));
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return this.pick(list);
    let roll = this.next() * total;
    for (let i = 0; i < list.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) return list[i]!;
    }
    return list[list.length - 1]!;
  }

  id(prefix = ''): string {
    return prefix + Math.floor(this.next() * 0xffffffff).toString(36).padStart(7, '0');
  }
}

/** Hachage stable d'une chaîne en entier 32 bits (pour dériver des graines). */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Copie d'un objet sans ses propriétés `undefined`.
 * Indispensable avant de fusionner une mise à jour partielle : `{ ...actuel, ...partiel }`
 * écraserait sinon les valeurs existantes par chaque champ non renseigné.
 */
export function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Nom de l'application tel qu'il s'affiche (titres, notifications). Aussi dans `index.html` et le manifeste de la PWA. */
export const APP_NAME = 'Popote';

/**
 * Pluriel d'un nom d'aliment : on accorde le premier mot (« yaourt aux fruits » → « yaourts aux
 * fruits », « gâteau de riz » → « gâteaux de riz »). Un nom déjà au pluriel ne change pas.
 */
export function pluralFr(label: string): string {
  const [first = '', ...rest] = label.trim().split(' ');
  if (!first || /[sxz]$/i.test(first)) return label.trim();
  return [/(eau|au|eu)$/i.test(first) ? `${first}x` : `${first}s`, ...rest].join(' ');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

// ───────────────────────────── Dates (ISO YYYY-MM-DD, sans fuseau) ─────────────────────────────

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function diffDays(fromIso: string, toIso: string): number {
  return Math.round((parseISODate(toIso).getTime() - parseISODate(fromIso).getTime()) / 86_400_000);
}

/** Lundi de la semaine contenant la date donnée. */
export function mondayOf(iso: string): string {
  const d = parseISODate(iso);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return toISODate(d);
}

export const DAY_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const;

// ───────────────────────────── Formatage ─────────────────────────────

export function formatGrams(grams: number, unit: 'g' | 'ml' = 'g'): string {
  if (unit === 'g' && grams >= 1000) {
    return `${(grams / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`;
  }
  if (unit === 'ml' && grams >= 1000) {
    return `${(grams / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L`;
  }
  return `${Math.round(grams).toLocaleString('fr-FR')} ${unit}`;
}

export function formatEuro(value: number): string {
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Normalise un texte pour les comparaisons (minuscules, sans accents). */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9% ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
