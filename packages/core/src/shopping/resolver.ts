/**
 * Résolution d'un code-barres en produit.
 *
 * Le scan n'est couplé à AUCUNE base produit unique : `ChainProductResolver` interroge
 * successivement plusieurs sources (base locale, produits déjà scannés, fournisseur magasin,
 * base externe autorisée). Une source en panne ou trop lente est simplement ignorée.
 */
import type { Nutrients, ScannedProduct } from '../types.js';

export interface ProductResolver {
  readonly name: string;
  resolve(ean: string): Promise<ScannedProduct | null>;
}

export interface ResolverAttempt {
  resolver: string;
  status: 'hit' | 'miss' | 'error' | 'timeout';
  ms: number;
}

export interface ResolveOutcome {
  product: ScannedProduct | null;
  attempts: ResolverAttempt[];
}

export class ChainProductResolver implements ProductResolver {
  readonly name = 'chain';

  constructor(
    private readonly resolvers: ProductResolver[],
    private readonly timeoutMs = 4000,
  ) {}

  async resolve(ean: string): Promise<ScannedProduct | null> {
    return (await this.resolveWithTrace(ean)).product;
  }

  async resolveWithTrace(ean: string): Promise<ResolveOutcome> {
    const attempts: ResolverAttempt[] = [];
    for (const resolver of this.resolvers) {
      const started = Date.now();
      try {
        const result = await withTimeout(resolver.resolve(ean), this.timeoutMs);
        const ms = Date.now() - started;
        if (result === TIMEOUT) {
          attempts.push({ resolver: resolver.name, status: 'timeout', ms });
          continue;
        }
        if (result) {
          attempts.push({ resolver: resolver.name, status: 'hit', ms });
          return { product: result, attempts };
        }
        attempts.push({ resolver: resolver.name, status: 'miss', ms });
      } catch {
        attempts.push({ resolver: resolver.name, status: 'error', ms: Date.now() - started });
      }
    }
    return { product: null, attempts };
  }
}

const TIMEOUT = Symbol('timeout');

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMEOUT), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// ───────────────────────────── Codes-barres ─────────────────────────────

/** Vérifie la clé de contrôle d'un code EAN-13, EAN-8 ou UPC-A. */
export function isValidEan(code: string): boolean {
  if (!/^\d{8}$|^\d{12,13}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** Les EAN commençant par 02 ou 20–29 encodent un poids ou un prix variable (rayon frais). */
export function isVariableWeightEan(code: string): boolean {
  return /^(02|2\d)\d{11}$/.test(code);
}

/** Convertit « 500 g », « 1,5 kg », « 4 x 125 g », « 75 cl », « 1 L » en grammes (ou millilitres). */
export function parseQuantity(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const clean = text.toLowerCase().replace(',', '.').replace(/\s+/g, ' ');
  const multi = clean.match(/(\d+)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(kg|g|l|cl|ml)\b/);
  const single = clean.match(/(\d+(?:\.\d+)?)\s*(kg|g|l|cl|ml)\b/);
  const factor: Record<string, number> = { kg: 1000, g: 1, l: 1000, cl: 10, ml: 1 };
  if (multi) return Math.round(Number(multi[1]) * Number(multi[2]) * factor[multi[3]!]!);
  if (single) return Math.round(Number(single[1]) * factor[single[2]!]!);
  return undefined;
}

// ───────────────────────────── Open Food Facts ─────────────────────────────

interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_fr?: string;
  generic_name_fr?: string;
  brands?: string;
  quantity?: string;
  product_quantity?: number | string;
  categories_tags?: string[];
  image_front_small_url?: string;
  nutriments?: Record<string, number | string | undefined>;
}

function num(value: number | string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Transforme une réponse de l'API produit Open Food Facts (v2) en `ScannedProduct`.
 * Données sous licence ODbL — https://world.openfoodfacts.org
 */
export function parseOpenFoodFactsProduct(payload: unknown, ean: string): ScannedProduct | null {
  const body = payload as { status?: number; product?: OffProduct } | null;
  const product = body?.product;
  if (!body || body.status === 0 || !product) return null;
  const name = product.product_name_fr || product.product_name || product.generic_name_fr;
  if (!name) return null;

  const nutriments = product.nutriments ?? {};
  const per100: Partial<Nutrients> = {};
  const kcal = num(nutriments['energy-kcal_100g']);
  const protein = num(nutriments['proteins_100g']);
  const carbs = num(nutriments['carbohydrates_100g']);
  const fat = num(nutriments['fat_100g']);
  const fiber = num(nutriments['fiber_100g']);
  if (kcal !== undefined) per100.kcal = kcal;
  if (protein !== undefined) per100.protein = protein;
  if (carbs !== undefined) per100.carbs = carbs;
  if (fat !== undefined) per100.fat = fat;
  if (fiber !== undefined) per100.fiber = fiber;

  return {
    ean,
    name: name.trim(),
    brand: product.brands?.split(',')[0]?.trim() || undefined,
    grams: num(product.product_quantity) ?? parseQuantity(product.quantity),
    per100: Object.keys(per100).length > 0 ? per100 : undefined,
    categories: product.categories_tags ?? [],
    imageUrl: product.image_front_small_url,
    source: 'off',
  };
}
