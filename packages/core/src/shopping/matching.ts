/**
 * Correspondance intelligente entre un produit scanné (concret) et la liste de courses (générique).
 * Le code-barres exact n'est qu'un cas particulier : on raisonne sur le type d'aliment,
 * les valeurs nutritionnelles, le poids, le prix et les préférences.
 */
import type { FoodIndex } from '../nutrition.js';
import type { Food, MatchResult, ScannedProduct, ShoppingSession, ShoppingSessionItem } from '../types.js';
import { normalize } from '../util.js';
import { pricePerKg } from './pricing.js';

export interface MatchPreferences {
  excludedFoods: string[];
  bannedBrands: string[];
}

/** Devine l'aliment générique d'un produit : rattachement connu, catégories Open Food Facts, puis mots-clés. */
export function inferFood(product: ScannedProduct, foods: Food[]): { food: Food; confidence: number } | null {
  if (product.foodId) {
    const known = foods.find((f) => f.id === product.foodId);
    if (known) return { food: known, confidence: 1 };
  }
  const categories = new Set((product.categories ?? []).map((c) => c.toLowerCase()));
  const name = ` ${normalize(`${product.name} ${product.brand ?? ''}`)} `;

  let best: { food: Food; confidence: number } | null = null;
  for (const food of foods) {
    let confidence = 0;
    const categoryHits = food.offCategories.filter((c) => categories.has(c)).length;
    if (categoryHits > 0) confidence = 0.6 + Math.min(0.2, 0.1 * categoryHits);

    // Le mot-clé le plus long l'emporte : « pâtes complètes » avant « pâtes ».
    const keyword = food.keywords
      .map((k) => normalize(k))
      .filter((k) => name.includes(` ${k} `) || name.includes(` ${k}s `))
      .sort((a, b) => b.length - a.length)[0];
    if (keyword) confidence = Math.max(confidence, 0.45) + Math.min(0.25, keyword.length / 60);

    if (confidence > 0 && product.per100?.kcal !== undefined) {
      const drift = Math.abs(product.per100.kcal - food.per100.kcal) / Math.max(1, food.per100.kcal);
      if (drift < 0.15) confidence += 0.1;
      else if (drift > 0.5) confidence -= 0.25;
    }
    if (confidence > (best?.confidence ?? 0.4)) best = { food, confidence: Math.min(1, confidence) };
  }
  return best;
}

function remainingG(item: ShoppingSessionItem): number {
  const got = item.scans.reduce((sum, s) => sum + s.grams * s.qty, 0);
  return Math.max(0, item.neededG - got);
}

/**
 * Détermine ce que représente un produit scanné vis-à-vis de la session de courses :
 * article prévu, remplacement acceptable, produit imprévu ou produit refusé.
 */
export function matchScannedProduct(
  product: ScannedProduct,
  session: Pick<ShoppingSession, 'items'>,
  foods: FoodIndex,
  prefs: MatchPreferences,
): MatchResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (product.brand && prefs.bannedBrands.some((b) => normalize(b) === normalize(product.brand!))) {
    return { kind: 'rejected', score: 0, reasons: [`La marque ${product.brand} fait partie de tes marques interdites.`], warnings };
  }

  // 1. Code-barres d'un produit explicitement prévu.
  if (product.ean) {
    const planned = session.items.find((i) => i.planned.some((p) => p.ean === product.ean));
    if (planned) {
      return { kind: 'exact', itemId: planned.id, foodId: planned.foodId, score: 1, reasons: ['Produit prévu dans la liste.'], warnings };
    }
  }

  const inferred = inferFood(product, [...foods.values()]);
  if (!inferred) {
    return { kind: 'unplanned', score: 0, reasons: ["Produit non reconnu comme un aliment de la liste."], warnings };
  }
  const { food, confidence } = inferred;
  if (prefs.excludedFoods.includes(food.id)) {
    return { kind: 'rejected', foodId: food.id, score: 0, reasons: [`${food.name} fait partie de tes aliments refusés.`], warnings };
  }

  // 2. Même aliment générique, autre marque ou autre format.
  let item = session.items.find((i) => i.foodId === food.id && remainingG(i) > 0) ?? session.items.find((i) => i.foodId === food.id);
  let substitute = false;

  // 3. Aliment différent mais interchangeable (même groupe de substitution).
  if (!item && food.substitutionGroup) {
    item =
      session.items.find((i) => foods.get(i.foodId)?.substitutionGroup === food.substitutionGroup && remainingG(i) > 0) ??
      session.items.find((i) => foods.get(i.foodId)?.substitutionGroup === food.substitutionGroup);
    substitute = !!item;
  }
  if (!item) {
    return {
      kind: 'unplanned',
      foodId: food.id,
      score: confidence,
      reasons: [`Reconnu comme « ${food.name} », qui n'est pas prévu cette semaine.`],
      warnings,
    };
  }

  const plannedFood = foods.get(item.foodId)!;
  reasons.push(substitute ? `Même famille que « ${plannedFood.name} ».` : `Correspond à « ${plannedFood.name} ».`);

  // Écart nutritionnel par rapport à l'aliment prévu.
  const kcal = product.per100?.kcal ?? food.per100.kcal;
  const protein = product.per100?.protein ?? food.per100.protein;
  const kcalDelta = kcal - plannedFood.per100.kcal;
  const proteinDelta = protein - plannedFood.per100.protein;
  const kcalDrift = Math.abs(kcalDelta) / Math.max(1, plannedFood.per100.kcal);
  const proteinDrift = plannedFood.per100.protein >= 5 ? -proteinDelta / plannedFood.per100.protein : 0;
  let score = confidence;

  if (kcalDrift > 0.4) {
    return {
      kind: 'rejected',
      itemId: item.id,
      foodId: food.id,
      score: 0,
      reasons: [`Trop éloigné de « ${plannedFood.name} » : ${Math.round(kcal)} kcal/100 g contre ${Math.round(plannedFood.per100.kcal)} prévues.`],
      warnings,
    };
  }
  if (kcalDrift > 0.12) {
    warnings.push(`${kcalDelta > 0 ? '+' : ''}${Math.round(kcalDelta)} kcal pour 100 g par rapport au produit prévu.`);
    score -= 0.15;
  }
  if (proteinDrift > 0.2) {
    warnings.push(`${Math.round(-proteinDelta * 10) / 10} g de protéines en moins pour 100 g.`);
    score -= 0.15;
  }

  // Poids du conditionnement par rapport à ce qu'il reste à prendre.
  const remaining = remainingG(item);
  if (product.grams && remaining > 0 && product.grams > remaining * 2 && plannedFood.perishable) {
    warnings.push(`Format de ${product.grams} g pour ${Math.round(remaining)} g restants : il y aura du surplus.`);
    score -= 0.05;
  }

  // Prix au kilo par rapport au prévu.
  let priceDelta: number | undefined;
  const plannedPack = item.planned[0];
  if (product.price && product.grams && plannedPack && plannedPack.grams > 0) {
    priceDelta = Math.round((pricePerKg(product.price, product.grams) - pricePerKg(plannedPack.price, plannedPack.grams)) * 100) / 100;
    if (priceDelta > 0.5) warnings.push(`${priceDelta.toFixed(2).replace('.', ',')} €/kg plus cher que prévu.`);
    if (priceDelta < -0.5) reasons.push(`${Math.abs(priceDelta).toFixed(2).replace('.', ',')} €/kg moins cher que prévu.`);
  }

  const needsConfirmation = substitute || warnings.length > 0;
  return {
    kind: needsConfirmation ? 'substitute' : 'exact',
    itemId: item.id,
    foodId: food.id,
    score: Math.max(0, Math.min(1, score)),
    reasons,
    warnings,
    deltas: {
      kcalPer100: Math.round(kcalDelta),
      proteinPer100: Math.round(proteinDelta * 10) / 10,
      weeklyKcal: Math.round((kcalDelta * item.neededG) / 100),
      pricePerKg: priceDelta,
    },
  };
}
