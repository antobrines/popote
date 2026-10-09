/**
 * Solveur de quantités.
 *
 * - `solveMeal` : résout les grammes du levier protéine et du levier énergie d'un repas
 *   pour viser un couple (kcal, protéines), en respectant bornes et pas d'arrondi.
 * - `balanceDay` : ajuste finement les leviers de tous les repas modifiables d'une journée
 *   pour retomber dans la tolérance calorique et atteindre la cible protéique.
 */
import { type FoodIndex, ZERO, itemsNutritionExact, mealNutrition, requireFood } from '../nutrition.js';
import type { Food, Meal, MealItem, NutritionTarget, Nutrients } from '../types.js';
import { clamp, roundToStep } from '../util.js';

/** Marge haute tolérée au-dessus de la cible protéique avant de rééquilibrer vers les glucides. */
const PROTEIN_OVERSHOOT = 12;
/** Marge basse tolérée sous la cible protéique. */
const PROTEIN_UNDERSHOOT = 2;

function density(food: Food): { k: number; p: number } {
  return { k: food.per100.kcal / 100, p: food.per100.protein / 100 };
}

function snap(item: MealItem, grams: number): number {
  const snapped = item.min + roundToStep(grams - item.min, item.step);
  return clamp(snapped, item.min, item.max);
}

function kcalRange(item: MealItem, foods: FoodIndex): number {
  return (item.max - item.min) * density(requireFood(foods, item.foodId)).k;
}

/** Résout les quantités d'un repas pour approcher (kcal, protéines). Modifie `items` en place. */
export function solveMeal(items: MealItem[], foods: FoodIndex, targetKcal: number, targetProtein: number): void {
  const byRange = (a: MealItem, b: MealItem) => kcalRange(b, foods) - kcalRange(a, foods);
  const proteinLevers = items.filter((i) => i.scaling === 'protein').sort(byRange);
  const energyLevers = items.filter((i) => i.scaling === 'energy').sort(byRange);
  const pl = proteinLevers[0];
  const el = energyLevers[0];
  if (!pl && !el) return;

  const others = items.filter((i) => i !== pl && i !== el);
  const base = itemsNutritionExact(others, foods);
  const K = targetKcal - base.kcal;
  const P = targetProtein - base.protein;

  if (pl && el) {
    const a = density(requireFood(foods, pl.foodId));
    const b = density(requireFood(foods, el.foodId));
    const det = a.k * b.p - b.k * a.p;
    const rawProtein = Math.abs(det) > 1e-9 ? (K * b.p - b.k * P) / det : pl.grams;
    pl.grams = snap(pl, rawProtein);
    el.grams = snap(el, (K - pl.grams * a.k) / b.k);
    // Si le féculent bute sur une borne, on rattrape les calories avec la protéine.
    const miss = K - pl.grams * a.k - el.grams * b.k;
    if (Math.abs(miss) > (a.k * pl.step) / 2) {
      pl.grams = snap(pl, pl.grams + miss / a.k);
    }
    return;
  }

  const lever = (pl ?? el)!;
  const d = density(requireFood(foods, lever.foodId));
  lever.grams = snap(lever, K / d.k);
}

export interface BalanceResult {
  nutrition: Nutrients;
  kcalGap: number;
  proteinGap: number;
  withinTolerance: boolean;
}

interface Move {
  item: MealItem;
  delta: number;
  dK: number;
  dP: number;
}

function movesFor(items: MealItem[], foods: FoodIndex): Move[] {
  const moves: Move[] = [];
  for (const item of items) {
    const d = density(requireFood(foods, item.foodId));
    if (item.grams + item.step <= item.max + 1e-9) {
      moves.push({ item, delta: item.step, dK: d.k * item.step, dP: d.p * item.step });
    }
    if (item.grams - item.step >= item.min - 1e-9) {
      moves.push({ item, delta: -item.step, dK: -d.k * item.step, dP: -d.p * item.step });
    }
  }
  return moves;
}

/**
 * Ajuste les repas modifiables d'une journée.
 *
 * @param meals        repas dont les quantités peuvent bouger (ni mangés, ni verrouillés)
 * @param fixedIntake  apport déjà acquis et non modifiable (repas mangés, extras)
 */
export function balanceDay(
  meals: Meal[],
  foods: FoodIndex,
  target: NutritionTarget,
  fixedIntake: Nutrients = ZERO,
): BalanceResult {
  const all = meals.flatMap((m) => m.items);
  const proteinLevers = all.filter((i) => i.scaling === 'protein');
  const energyLevers = all.filter((i) => i.scaling === 'energy');
  // En dernier recours : matières grasses et oléagineux fixes, qui restent ajustables par pas de 5 g.
  const fatLevers = all.filter((i) => {
    if (i.scaling !== 'fixed') return false;
    const category = requireFood(foods, i.foodId).category;
    return (category === 'matiere-grasse' || category === 'oleagineux') && i.max > i.min;
  });

  // Quand viandes et poissons sont déjà au maximum (saumon, cuisses de poulet…), le laitage de fin
  // de repas peut encore grossir : un second pot de skyr, un peu plus de fromage blanc.
  const dairyLevers = all.filter((i) => i.scaling === 'fixed' && requireFood(foods, i.foodId).category === 'laitier' && i.max > i.min);

  const totals = (): Nutrients => {
    const t = itemsNutritionExact(all, foods);
    return { ...t, kcal: t.kcal + fixedIntake.kcal, protein: t.protein + fixedIntake.protein };
  };

  for (let iteration = 0; iteration < 400; iteration++) {
    const t = totals();
    const dK = target.kcal - t.kcal;
    const dP = target.protein - t.protein;

    // 1. Protéines insuffisantes : on monte un levier protéine sans dépasser la marge haute —
    //    et seulement si les calories ajoutées peuvent encore être reprises ailleurs.
    if (dP > PROTEIN_UNDERSHOOT) {
      const cuttable = [...energyLevers, ...fatLevers].reduce((sum, i) => sum + ((i.grams - i.min) * requireFood(foods, i.foodId).per100.kcal) / 100, 0);
      const raise = (levers: MealItem[]): Move | undefined =>
        movesFor(levers, foods)
          .filter((m) => m.delta > 0 && m.dP <= dP + PROTEIN_OVERSHOOT && m.dK <= dK + cuttable + target.toleranceKcal * 0.4)
          .sort((a, b) => b.item.max - b.item.grams - (a.item.max - a.item.grams))[0];
      const up = raise(proteinLevers) ?? raise(dairyLevers);
      if (up) {
        up.item.grams += up.delta;
        continue;
      }
    }
    // 2. Protéines très au-dessus : on redescend, sans passer sous la cible.
    if (dP < -PROTEIN_OVERSHOOT) {
      const down = movesFor(proteinLevers, foods)
        .filter((m) => m.delta < 0 && -m.dP <= -dP - PROTEIN_UNDERSHOOT)
        .sort((a, b) => b.item.grams - b.item.min - (a.item.grams - a.item.min))[0];
      if (down) {
        down.item.grams += down.delta;
        continue;
      }
    }

    // 3. Calories : le meilleur pas qui rapproche de la cible, féculents d'abord.
    const improving = (levers: MealItem[], guardProtein: boolean): Move | undefined =>
      movesFor(levers, foods)
        .filter((m) => Math.abs(dK - m.dK) < Math.abs(dK) - 1e-6)
        .filter((m) => !guardProtein || (dP - m.dP <= PROTEIN_UNDERSHOOT && dP - m.dP >= -PROTEIN_OVERSHOOT))
        .sort((a, b) => Math.abs(dK - a.dK) - Math.abs(dK - b.dK))[0];

    const move = improving(energyLevers, false) ?? improving(fatLevers, false) ?? improving(proteinLevers, true);
    if (move) {
      move.item.grams += move.delta;
      continue;
    }
    // 4. Dernier recours : calories encore hors tolérance alors que féculents et matières grasses
    //    sont à leurs bornes. La tolérance calorique prime : on cède un peu de protéines.
    if (Math.abs(dK) <= target.toleranceKcal) break;
    const forced = improving([...proteinLevers, ...dairyLevers], false);
    if (!forced) break;
    forced.item.grams += forced.delta;
  }

  for (const meal of meals) {
    meal.nutrition = mealNutrition(meal, foods);
  }
  const t = totals();
  const kcalGap = target.kcal - t.kcal;
  const proteinGap = target.protein - t.protein;
  return {
    nutrition: t,
    kcalGap,
    proteinGap,
    withinTolerance: Math.abs(kcalGap) <= target.toleranceKcal,
  };
}
