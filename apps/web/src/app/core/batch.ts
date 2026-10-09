/**
 * « Cuisiner une fois, manger deux fois » côté écran : qui cuisine pour qui, et les quantités à
 * préparer en une fois. Rien n'est stocké : tout se déduit du programme.
 */
import { type Meal, type WeekPlan, cookOncePairs, cookedItems } from '@bouffe/core';

export interface BatchInfo {
  /** `cook` : ce dîner se cuisine en double. `leftover` : ce déjeuner a été cuisiné la veille. */
  role: 'cook' | 'leftover';
  partner: Meal;
  partnerDay: number;
}

export function batchInfo(plan: Pick<WeekPlan, 'days'> | null, mealId: string): BatchInfo | null {
  if (!plan) return null;
  for (const pair of cookOncePairs(plan)) {
    const cook = plan.days[pair.cookDay]!.meals.find((m) => m.id === pair.cookMealId)!;
    const eat = plan.days[pair.eatDay]!.meals.find((m) => m.id === pair.eatMealId)!;
    // Une fois l'un des deux repas déclaré, on ne parle plus de cuisine double.
    if (cook.status !== 'planned' && pair.cookMealId === mealId) continue;
    if (pair.cookMealId === mealId) return { role: 'cook', partner: eat, partnerDay: pair.eatDay };
    if (pair.eatMealId === mealId) return { role: 'leftover', partner: cook, partnerDay: pair.cookDay };
  }
  return null;
}

/** Rôle de chaque repas du programme, par identifiant. */
export function batchRoles(plan: Pick<WeekPlan, 'days'> | null): Map<string, 'cook' | 'leftover'> {
  const roles = new Map<string, 'cook' | 'leftover'>();
  if (!plan) return roles;
  for (const pair of cookOncePairs(plan)) {
    roles.set(pair.cookMealId, 'cook');
    roles.set(pair.eatMealId, 'leftover');
  }
  return roles;
}

/**
 * Le repas à cuisiner ce soir, avec les quantités des deux portions additionnées pour tout ce qui
 * se cuisine (viande, féculent, sauce…). Laitage et fruit restent ceux du soir.
 */
export function combinedForCooking(meal: Meal, partner: Meal): Meal {
  const cookable = new Set(cookedItems(meal.items).map((i) => i.slotKey));
  return {
    ...meal,
    items: meal.items.map((item) => {
      const other = partner.items.find((i) => i.slotKey === item.slotKey && i.foodId === item.foodId);
      return cookable.has(item.slotKey) && other ? { ...item, grams: item.grams + other.grams } : item;
    }),
  };
}
