/**
 * Service de prix et de conditionnement : TOUS les calculs de prix passent par ici.
 */
import type { PackageChoice, PackageOption, ShoppingStrategy } from '../types.js';
import { diffDays } from '../util.js';

export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function pricePerKg(price: number, grams: number): number {
  if (grams <= 0) return 0;
  return roundCents((price / grams) * 1000);
}

export type PriceFreshness = 'fresh' | 'aging' | 'stale' | 'unknown';

/** Un prix mémorisé vieillit : au-delà de 30 jours il est à confirmer, au-delà de 90 il est obsolète. */
export function priceFreshness(priceDate: string | undefined, today: string): PriceFreshness {
  if (!priceDate) return 'unknown';
  const age = diffDays(priceDate.slice(0, 10), today);
  if (age <= 30) return 'fresh';
  if (age <= 90) return 'aging';
  return 'stale';
}

function toChoice(option: PackageOption, count: number): PackageChoice {
  return {
    label: option.label,
    grams: option.grams,
    price: option.price,
    count,
    variableWeight: option.variableWeight,
    brand: option.brand,
    ean: option.ean,
    productId: option.productId,
    retailProductId: option.retailProductId,
    source: option.source,
    priceDate: option.priceDate,
  };
}

export interface PackagePlan {
  choices: PackageChoice[];
  boughtG: number;
  cost: number;
}

export function choicesTotals(choices: PackageChoice[]): { boughtG: number; cost: number } {
  return {
    boughtG: choices.reduce((sum, c) => sum + c.grams * c.count, 0),
    cost: roundCents(choices.reduce((sum, c) => sum + c.price * c.count, 0)),
  };
}

/**
 * Choisit la combinaison de conditionnements couvrant `neededG`.
 *
 * - `cheapest`        : coût total minimal, puis moins de reste.
 * - `least-waste`     : reste minimal, puis coût.
 * - `best-unit-price` : pour les produits non périssables, accepte un plus gros format si le reste
 *                       est « récupéré » à un bon prix au kilo (le reste sert les semaines suivantes).
 *
 * Programmation dynamique exacte sur les grammes (sac à dos non borné « au moins »).
 */
export function optimizePackages(
  neededG: number,
  options: PackageOption[],
  strategy: ShoppingStrategy = 'cheapest',
  perishable = true,
): PackagePlan {
  if (neededG <= 0 || options.length === 0) return { choices: [], boughtG: 0, cost: 0 };
  const needed = Math.ceil(neededG);

  const fixed = options.filter((o) => !o.variableWeight && o.grams > 0);
  const variable = options.filter((o) => o.variableWeight && o.grams > 0);

  let best: PackagePlan | null = null;
  let bestKey: number[] | null = null;
  const better = (key: number[], current: number[] | null): boolean => {
    if (!current) return true;
    for (let i = 0; i < key.length; i++) {
      if (key[i]! < current[i]! - 1e-9) return true;
      if (key[i]! > current[i]! + 1e-9) return false;
    }
    return false;
  };
  const bestUnit = Math.min(...options.map((o) => o.price / o.grams));
  const keyFor = (cost: number, boughtG: number, count: number): number[] => {
    const leftover = boughtG - needed;
    if (strategy === 'least-waste') return [leftover, cost, count];
    if (strategy === 'best-unit-price') {
      // Le reste d'un produit qui se conserve garde 90 % de sa valeur : il servira les semaines suivantes.
      const recovered = perishable ? 0 : 0.9 * leftover * bestUnit;
      return [cost - recovered, count, leftover];
    }
    return [cost, leftover, count];
  };

  // Produits au poids : on paie exactement la quantité prise.
  for (const option of variable) {
    const cost = roundCents((option.price / option.grams) * needed);
    const key = keyFor(cost, needed, 1);
    if (better(key, bestKey)) {
      bestKey = key;
      best = { choices: [{ ...toChoice(option, 1), grams: needed, price: cost, label: option.label }], boughtG: needed, cost };
    }
  }

  if (fixed.length > 0) {
    const maxPack = Math.max(...fixed.map((o) => o.grams));
    const limit = needed + Math.ceil(maxPack);
    const cost = new Float64Array(limit + 1).fill(Infinity);
    const count = new Int32Array(limit + 1);
    const lastOption = new Int32Array(limit + 1).fill(-1);
    cost[0] = 0;
    for (let q = 1; q <= limit; q++) {
      for (let o = 0; o < fixed.length; o++) {
        const g = Math.round(fixed[o]!.grams);
        if (g > q || cost[q - g] === Infinity) continue;
        const c = cost[q - g]! + fixed[o]!.price;
        if (c < cost[q]! - 1e-9 || (Math.abs(c - cost[q]!) < 1e-9 && count[q - g]! + 1 < count[q]!)) {
          cost[q] = c;
          count[q] = count[q - g]! + 1;
          lastOption[q] = o;
        }
      }
    }
    let bestQ = -1;
    for (let q = needed; q <= limit; q++) {
      if (cost[q] === Infinity) continue;
      const key = keyFor(cost[q]!, q, count[q]!);
      if (better(key, bestKey)) {
        bestKey = key;
        bestQ = q;
      }
    }
    if (bestQ >= 0) {
      const counts = new Map<number, number>();
      let q = bestQ;
      while (q > 0) {
        const o = lastOption[q]!;
        counts.set(o, (counts.get(o) ?? 0) + 1);
        q -= Math.round(fixed[o]!.grams);
      }
      const choices = [...counts.entries()]
        .map(([o, n]) => toChoice(fixed[o]!, n))
        .sort((a, b) => b.grams - a.grams);
      best = { choices, ...choicesTotals(choices) };
    }
  }

  return best ?? { choices: [], boughtG: 0, cost: 0 };
}

/** Prix au kilo le plus bas disponible pour un aliment. */
export function bestPricePerKg(options: PackageOption[]): number | null {
  const valid = options.filter((o) => o.grams > 0);
  if (valid.length === 0) return null;
  return pricePerKg(Math.min(...valid.map((o) => o.price / o.grams)) * 1000, 1000);
}
