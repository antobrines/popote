/**
 * Apprentissage des habitudes d'achat à partir de l'historique des courses.
 * Les suggestions sont toujours soumises à la validation de l'utilisateur.
 */
import type { FoodIndex } from '../nutrition.js';
import type { FoodHabit, HabitSuggestion, PurchaseSummary, ShoppingListData } from '../types.js';
import { formatGrams } from '../util.js';
import { lowerName } from '../planner/recipe.js';
import { pricePerKg } from './pricing.js';

function mostFrequent<T>(values: T[]): { value: T; count: number } | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: { value: T; count: number } | undefined;
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

export function computeHabits(purchases: PurchaseSummary[]): FoodHabit[] {
  const byFood = new Map<string, { brands: string[]; packs: number[]; perKg: number[]; substitutions: number; trips: Set<string>; missing: number }>();
  const entry = (foodId: string) => {
    let e = byFood.get(foodId);
    if (!e) {
      e = { brands: [], packs: [], perKg: [], substitutions: 0, trips: new Set(), missing: 0 };
      byFood.set(foodId, e);
    }
    return e;
  };

  for (const purchase of purchases) {
    for (const item of purchase.items) {
      if (!item.foodId || item.unplanned) continue;
      const e = entry(item.foodId);
      e.trips.add(purchase.sessionId);
      if (item.brand) e.brands.push(item.brand);
      if (item.grams > 0) e.packs.push(Math.round(item.grams / 10) * 10);
      if (item.price !== undefined && item.grams > 0) e.perKg.push(pricePerKg(item.price, item.grams));
      if (item.substitution) e.substitutions += 1;
    }
    for (const missing of purchase.missing) entry(missing.foodId).missing += 1;
  }

  return [...byFood.entries()].map(([foodId, e]) => ({
    foodId,
    purchases: e.trips.size,
    usualBrand: mostFrequent(e.brands)?.value,
    usualPackGrams: mostFrequent(e.packs)?.value,
    avgPricePerKg: e.perKg.length ? Math.round((e.perKg.reduce((a, b) => a + b, 0) / e.perKg.length) * 100) / 100 : undefined,
    substitutions: e.substitutions,
    missingCount: e.missing,
  }));
}

/**
 * Propose d'adapter la liste aux habitudes constatées (format habituel, produit souvent absent).
 * Une habitude n'est retenue qu'à partir de deux passages en magasin.
 */
export function habitSuggestions(list: ShoppingListData, habits: FoodHabit[], foods: FoodIndex): HabitSuggestion[] {
  const suggestions: HabitSuggestion[] = [];
  for (const habit of habits) {
    const item = list.items.find((i) => i.foodId === habit.foodId && i.toBuyG > 0);
    const food = foods.get(habit.foodId);
    if (!item || !food) continue;

    if (habit.purchases >= 2 && habit.usualPackGrams) {
      const planned = item.packages[0];
      const differs = planned && !planned.variableWeight && Math.abs(planned.grams - habit.usualPackGrams) > planned.grams * 0.1;
      if (differs) {
        suggestions.push({
          foodId: habit.foodId,
          kind: 'package',
          message: `Tu achètes généralement ${lowerName(food.name)} en conditionnement de ${formatGrams(habit.usualPackGrams, food.unit)}${habit.usualBrand ? ` (${habit.usualBrand})` : ''}. Adapter la liste de cette semaine à ce format ?`,
          packGrams: habit.usualPackGrams,
          brand: habit.usualBrand,
          price: habit.avgPricePerKg ? Math.round(((habit.avgPricePerKg * habit.usualPackGrams) / 1000) * 100) / 100 : undefined,
        });
      }
    }
    if (habit.missingCount >= 2) {
      suggestions.push({
        foodId: habit.foodId,
        kind: 'rarely-available',
        message: `${food.name} était indisponible lors de ${habit.missingCount} courses récentes. Tu peux le remplacer dans le programme ou prévoir une alternative.`,
      });
    }
  }
  return suggestions;
}
