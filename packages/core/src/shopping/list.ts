/**
 * Moteur de liste de courses : programme → besoins → stocks → conditionnements → coûts.
 */
import { DEFAULT_AISLE_ORDER } from '../data/foods.js';
import type { FoodIndex } from '../nutrition.js';
import { requireFood } from '../nutrition.js';
import type {
  Aisle,
  PackageOption,
  ShoppingListData,
  ShoppingListItem,
  ShoppingStrategy,
  ShoppingTotals,
  WeekPlan,
} from '../types.js';
import { choicesTotals, optimizePackages, pricePerKg, roundCents } from './pricing.js';

export interface ShoppingListInput {
  plan: Pick<WeekPlan, 'weekStart' | 'days'>;
  foods: FoodIndex;
  /** Stocks disponibles (g) par aliment. */
  inventory: Record<string, number>;
  /** Conditionnements connus par aliment ; à défaut, ceux (estimés) de l'aliment sont utilisés. */
  packages: Record<string, PackageOption[]>;
  strategy: ShoppingStrategy;
  aisleOrder?: Aisle[];
  /** Articles déjà cochés (identifiants), conservés lors d'un recalcul. */
  checked?: string[];
  /** Ne compter que les jours à partir de cette date (programme créé en cours de semaine). */
  fromDate?: string;
}

/** Besoins de la semaine (g) par aliment, pour les repas encore prévus. */
export function weeklyNeeds(plan: Pick<WeekPlan, 'days'>, fromDate?: string): Map<string, number> {
  const needs = new Map<string, number>();
  for (const day of plan.days) {
    if (fromDate && day.date < fromDate) continue;
    for (const meal of day.meals) {
      if (meal.status !== 'planned') continue;
      for (const item of meal.items) {
        needs.set(item.foodId, (needs.get(item.foodId) ?? 0) + item.grams);
      }
    }
  }
  return needs;
}

export function shoppingTotals(items: ShoppingListItem[], plan: Pick<WeekPlan, 'days'>, fromDate?: string): ShoppingTotals {
  const cost = roundCents(items.reduce((sum, i) => sum + i.cost, 0));
  // Programme créé en cours de semaine : la liste ne couvre que les jours restants.
  const covered = plan.days.filter((d) => !fromDate || d.date >= fromDate);
  const days = Math.max(1, covered.length);
  const meals = Math.max(1, covered.reduce((sum, d) => sum + d.meals.filter((m) => m.status === 'planned').length, 0));
  const consumedCost = roundCents(
    items.reduce((sum, i) => sum + (i.pricePerKg !== null ? (i.pricePerKg * i.toBuyG) / 1000 : 0), 0),
  );
  const estimated = items.filter((i) => i.priceSource === 'estimate' || i.priceSource === 'example').reduce((sum, i) => sum + i.cost, 0);
  return {
    cost,
    perDay: roundCents(cost / days),
    perMeal: roundCents(cost / meals),
    consumedCost,
    itemsToBuy: items.filter((i) => i.toBuyG > 0).length,
    itemsInStock: items.filter((i) => i.toBuyG <= 0).length,
    estimatedShare: cost > 0 ? Math.round((estimated / cost) * 100) / 100 : 0,
  };
}

export function buildShoppingList(input: ShoppingListInput): ShoppingListData {
  const order = input.aisleOrder ?? DEFAULT_AISLE_ORDER;
  const checked = new Set(input.checked ?? []);
  const items: ShoppingListItem[] = [];

  for (const [foodId, neededG] of weeklyNeeds(input.plan, input.fromDate)) {
    const food = requireFood(input.foods, foodId);
    const stock = Math.max(0, input.inventory[foodId] ?? 0);
    const fromStockG = Math.min(stock, neededG);
    const toBuyG = Math.max(0, neededG - fromStockG);
    const options = input.packages[foodId]?.length ? input.packages[foodId]! : food.packages;
    const plan = optimizePackages(toBuyG, options, input.strategy, food.perishable);
    const { boughtG, cost } = choicesTotals(plan.choices);
    const main = plan.choices[0];
    const id = `sli-${foodId}`;

    items.push({
      id,
      foodId,
      name: food.name,
      aisle: food.aisle,
      unit: food.unit,
      pieceGrams: food.piece?.grams,
      pieceLabel: food.piece?.label,
      neededG,
      fromStockG,
      toBuyG,
      packages: plan.choices,
      boughtG,
      leftoverG: Math.max(0, stock + boughtG - neededG),
      pricePerKg: boughtG > 0 ? pricePerKg(cost, boughtG) : null,
      cost,
      priceSource: main?.source ?? null,
      priceDate: main?.priceDate,
      checked: checked.has(id),
    });
  }

  const rank = (aisle: Aisle) => {
    const i = order.indexOf(aisle);
    return i < 0 ? order.length : i;
  };
  items.sort((a, b) => rank(a.aisle) - rank(b.aisle) || a.name.localeCompare(b.name, 'fr'));

  return {
    weekStart: input.plan.weekStart,
    strategy: input.strategy,
    items,
    totals: shoppingTotals(items, input.plan, input.fromDate),
  };
}

export interface WasteLine {
  foodId: string;
  name: string;
  leftoverG: number;
  unit: 'g' | 'ml';
}

/**
 * Restes périssables prévus en fin de semaine : ce qu'il faudra finir ou congeler.
 * (Les produits qui se conservent — riz, pâtes, conserves — n'y figurent pas.)
 */
export function wasteReport(list: Pick<ShoppingListData, 'items'>, foods: FoodIndex): WasteLine[] {
  return list.items
    .filter((item) => {
      const food = foods.get(item.foodId);
      return !!food?.perishable && item.toBuyG > 0 && item.leftoverG >= 30 && item.leftoverG >= item.boughtG * 0.15;
    })
    .map((item) => ({ foodId: item.foodId, name: item.name, leftoverG: Math.round(item.leftoverG), unit: item.unit }))
    .sort((a, b) => b.leftoverG - a.leftoverG);
}

/** Regroupe les articles par rayon, dans l'ordre de parcours du magasin. */
export function groupByAisle<T extends { aisle: Aisle }>(items: T[], order: Aisle[] = DEFAULT_AISLE_ORDER): { aisle: Aisle; items: T[] }[] {
  const groups = new Map<Aisle, T[]>();
  for (const item of items) {
    const list = groups.get(item.aisle) ?? [];
    list.push(item);
    groups.set(item.aisle, list);
  }
  const rank = (aisle: Aisle) => {
    const i = order.indexOf(aisle);
    return i < 0 ? order.length : i;
  };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([aisle, list]) => ({ aisle, items: list }));
}

/** Export texte de la liste (partage, presse-papiers). */
export function shoppingListToText(list: ShoppingListData, aisleLabels: Record<string, string>): string {
  const lines: string[] = [`Courses — semaine du ${list.weekStart}`, ''];
  for (const group of groupByAisle(list.items.filter((i) => i.toBuyG > 0))) {
    lines.push(`${aisleLabels[group.aisle] ?? group.aisle}`);
    for (const item of group.items) {
      const packs = item.packages.map((p) => (p.variableWeight ? `${Math.round(p.grams)} g` : `${p.count} × ${p.label}`)).join(' + ');
      lines.push(`  [ ] ${item.name} — ${packs} (${item.cost.toFixed(2).replace('.', ',')} €)`);
    }
    lines.push('');
  }
  lines.push(`Total estimé : ${list.totals.cost.toFixed(2).replace('.', ',')} €`);
  return lines.join('\n');
}
