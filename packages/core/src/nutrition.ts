/**
 * Service de nutrition : TOUS les calculs nutritionnels de l'application passent par ici.
 * Les totaux d'un repas ou d'une journée sont toujours dérivés des ingrédients
 * (grammes × valeurs pour 100 g), jamais saisis ni stockés à la main.
 */
import type { ActivityLevel, Food, Meal, MealItem, Nutrients, Sex } from './types.js';

export const ZERO: Readonly<Nutrients> = Object.freeze({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Valeurs nutritionnelles exactes (non arrondies) d'une quantité d'aliment. */
export function nutrientsFor(food: Pick<Food, 'per100'>, grams: number): Nutrients {
  const f = grams / 100;
  return {
    kcal: food.per100.kcal * f,
    protein: food.per100.protein * f,
    carbs: food.per100.carbs * f,
    fat: food.per100.fat * f,
    fiber: food.per100.fiber * f,
  };
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
    fiber: a.fiber + b.fiber,
  };
}

export function sumNutrients(list: Nutrients[]): Nutrients {
  return list.reduce(addNutrients, { ...ZERO });
}

export function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  return {
    kcal: n.kcal * factor,
    protein: n.protein * factor,
    carbs: n.carbs * factor,
    fat: n.fat * factor,
    fiber: n.fiber * factor,
  };
}

/** Arrondi d'affichage : kcal à l'unité, macros au dixième. */
export function roundNutrients(n: Nutrients): Nutrients {
  return {
    kcal: Math.round(n.kcal),
    protein: round1(n.protein),
    carbs: round1(n.carbs),
    fat: round1(n.fat),
    fiber: round1(n.fiber),
  };
}

/**
 * Valeurs enregistrées pour un aliment réellement mangé : précises au centième.
 * (Arrondir chaque ligne à l'unité ferait dériver la somme du jour d'une ou deux kcal.)
 */
export function snapshotNutrients(n: Nutrients): Nutrients {
  return { kcal: round2(n.kcal), protein: round2(n.protein), carbs: round2(n.carbs), fat: round2(n.fat), fiber: round2(n.fiber) };
}

export type FoodIndex = Map<string, Food>;

export function indexFoods(foods: Food[]): FoodIndex {
  return new Map(foods.map((f) => [f.id, f]));
}

/**
 * Aliment ajouté par l'utilisateur (« Mes aliments → Ajouter un aliment »), par opposition à un
 * aliment du catalogue dont il a seulement remplacé les valeurs par celles de son produit.
 */
export function isOwnFood(food: Pick<Food, 'id' | 'custom'>): boolean {
  return food.custom === true && food.id.startsWith('mon-');
}

export function requireFood(index: FoodIndex, id: string): Food {
  const food = index.get(id);
  if (!food) throw new Error(`Aliment inconnu : ${id}`);
  return food;
}

/** Total exact d'une liste d'ingrédients. */
export function itemsNutritionExact(items: Pick<MealItem, 'foodId' | 'grams'>[], foods: FoodIndex): Nutrients {
  let total: Nutrients = { ...ZERO };
  for (const item of items) {
    total = addNutrients(total, nutrientsFor(requireFood(foods, item.foodId), item.grams));
  }
  return total;
}

/** Total arrondi d'une liste d'ingrédients (valeur affichée et stockée). */
export function itemsNutrition(items: Pick<MealItem, 'foodId' | 'grams'>[], foods: FoodIndex): Nutrients {
  return roundNutrients(itemsNutritionExact(items, foods));
}

export function mealNutrition(meal: Pick<Meal, 'items'>, foods: FoodIndex): Nutrients {
  return itemsNutrition(meal.items, foods);
}

/** Total d'une journée, calculé depuis tous les ingrédients (pas depuis les arrondis des repas). */
export function dayNutrition(meals: Pick<Meal, 'items'>[], foods: FoodIndex): Nutrients {
  return itemsNutrition(
    meals.flatMap((m) => m.items),
    foods,
  );
}

/** Poids cuit estimé à partir du poids cru. */
export function cookedGrams(food: Pick<Food, 'cookedYield'>, rawGrams: number): number | undefined {
  if (!food.cookedYield || food.cookedYield === 1) return undefined;
  return Math.round((rawGrams * food.cookedYield) / 5) * 5;
}

/** Nombre de pièces correspondant à un poids (œufs, pots…). */
export function piecesFor(food: Pick<Food, 'piece'>, grams: number): number | undefined {
  if (!food.piece) return undefined;
  return round1(grams / food.piece.grams);
}

/** Répartition des calories par macronutriment (en % de l'énergie). */
export function macroSplit(n: Nutrients): { protein: number; carbs: number; fat: number } {
  const p = n.protein * 4;
  const c = n.carbs * 4;
  const f = n.fat * 9;
  const total = p + c + f || 1;
  return {
    protein: Math.round((p / total) * 100),
    carbs: Math.round((c / total) * 100),
    fat: Math.round((f / total) * 100),
  };
}

// ───────────────────────────── Besoins énergétiques ─────────────────────────────

export interface BodyProfile {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
}

/** Métabolisme de base — équation de Mifflin-St Jeor. */
export function bmr(p: Pick<BodyProfile, 'sex' | 'age' | 'heightCm' | 'weightKg'>): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return Math.round(base + (p.sex === 'male' ? 5 : -161));
}

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
};

/** Dépense énergétique journalière estimée. */
export function tdee(p: BodyProfile): number {
  return Math.round(bmr(p) * ACTIVITY_FACTORS[p.activity]);
}

/**
 * Plancher calorique : l'application ne propose jamais de descendre en dessous.
 * On retient le plus élevé entre un minimum absolu par sexe et 90 % du métabolisme de base.
 */
export function calorieFloor(p: Pick<BodyProfile, 'sex' | 'age' | 'heightCm' | 'weightKg'>): number {
  const absolute = p.sex === 'male' ? 1600 : 1300;
  return Math.max(absolute, Math.round((bmr(p) * 0.9) / 10) * 10);
}

/**
 * Proposition initiale de budget calorique : déficit modéré (≈ 20 % de la dépense,
 * plafonné à 750 kcal), jamais sous le plancher.
 */
export function suggestedCalories(p: BodyProfile): number {
  const need = tdee(p);
  const deficit = Math.min(750, need * 0.2);
  return Math.max(calorieFloor(p), Math.round((need - deficit) / 50) * 50);
}

/** Cible protéique : ≈ 2 g par kg de poids objectif, bornée. */
export function suggestedProtein(goalWeightKg: number, kcal: number): number {
  const byWeight = goalWeightKg * 2;
  const maxByEnergy = (kcal * 0.35) / 4;
  return Math.round(Math.min(byWeight, maxByEnergy) / 5) * 5;
}
