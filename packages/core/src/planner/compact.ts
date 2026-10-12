/**
 * Écriture compacte d'un programme : un repas tient sur une ligne
 * (« 250 g poulet + 100 g riz cru + 10 g beurre + 1 compote »), une semaine dans un tableau
 * Jour / Midi / Collation / Soir.
 */
import { type FoodIndex } from '../nutrition.js';
import type { Food, Meal, MealSlotKind, WeekPlan } from '../types.js';
import { DAY_LABELS } from '../util.js';

/** Intitulés courts des créneaux, pour les en-têtes de tableau. */
export const SLOT_SHORT_LABELS: Record<MealSlotKind, string> = {
  'petit-dejeuner': 'Matin',
  dejeuner: 'Midi',
  collation: 'Collation',
  diner: 'Soir',
};

/**
 * « 250 g poulet », « 100 g riz cru », « 3 œufs », « 1 compote », « 140 g skyr ».
 * Ce qui se compte se compte ; le reste est en grammes, avec « cru » quand le poids est celui du
 * produit cru et que la cuisson le change beaucoup (riz, pâtes, pommes de terre).
 */
export function compactLabel(food: Pick<Food, 'shortName' | 'unit' | 'piece' | 'rawLabel' | 'byWeight'>, grams: number): string {
  if (food.piece && !food.byWeight) {
    const count = Math.round((grams / food.piece.grams) * 10) / 10;
    return `${count.toLocaleString('fr-FR')} ${count > 1 ? food.piece.plural : food.piece.label}`;
  }
  const name = food.rawLabel ? `${food.shortName} ${food.rawLabel}` : food.shortName;
  return `${Math.round(grams).toLocaleString('fr-FR')} ${food.unit} ${name}`;
}

/** Les ingrédients d'un repas sur une ligne, dans l'ordre du repas. */
export function compactItems(items: { foodId: string; grams: number }[], foods: FoodIndex): string {
  return items
    .map((item) => {
      const food = foods.get(item.foodId);
      return food ? compactLabel(food, item.grams) : item.foodId;
    })
    .join(' + ');
}

/** Un repas sur une ligne. Un repas libre s'écrit comme tel, avec son estimation. */
export function compactMeal(meal: Pick<Meal, 'items' | 'free' | 'status'>, foods: FoodIndex): string {
  if (meal.free) return `${meal.free.label} (≈ ${Math.round(meal.free.kcal).toLocaleString('fr-FR')} kcal)`;
  if (meal.status === 'skipped') return '—';
  return compactItems(meal.items, foods);
}

export interface PlanTable {
  /** Créneaux présents dans la semaine, dans l'ordre de la journée. */
  columns: { slot: MealSlotKind; label: string }[];
  rows: { dayIndex: number; date: string; day: string; cells: string[] }[];
}

/** La semaine en tableau : une ligne par jour, une colonne par repas. */
export function planTable(plan: Pick<WeekPlan, 'days' | 'structure'>, foods: FoodIndex): PlanTable {
  const columns = plan.structure.map((entry) => ({ slot: entry.slot, label: SLOT_SHORT_LABELS[entry.slot] }));
  return {
    columns,
    rows: plan.days.map((day) => ({
      dayIndex: day.index,
      date: day.date,
      day: DAY_LABELS[day.index] ?? day.date,
      cells: columns.map(({ slot }) => {
        const meal = day.meals.find((m) => m.slot === slot);
        return meal ? compactMeal(meal, foods) : '';
      }),
    })),
  };
}

/**
 * Le même tableau en texte tabulé (« Jour ⇥ Midi ⇥ Collation ⇥ Soir ») : se colle tel quel dans
 * un tableur, une note ou un message.
 */
export function planTableText(plan: Pick<WeekPlan, 'days' | 'structure'>, foods: FoodIndex): string {
  const table = planTable(plan, foods);
  return [['Jour', ...table.columns.map((c) => c.label)], ...table.rows.map((row) => [row.day, ...row.cells])].map((line) => line.join('\t')).join('\n');
}
