/**
 * Cible calorique de chaque jour.
 *
 * La cible d'un jour part du budget de la semaine, puis tient compte :
 *  - des jours d'entraînement (`baseKcal`) : plus de calories ces jours-là, moins les autres,
 *    pour une moyenne hebdomadaire inchangée ;
 *  - d'un éventuel repas libre lissé sur les jours suivants (`spreadKcal`, toujours ≤ 0).
 */
import type { MealPlanDay, NutritionTarget, WeekPlan } from '../types.js';

export interface TrainingPlan {
  /** Jours d'entraînement, du lundi au dimanche. */
  days: boolean[];
  /** Calories ajoutées un jour d'entraînement. */
  bonusKcal: number;
  /** Plancher sous lequel un jour de repos ne descend jamais. */
  floorKcal?: number;
}

export function dayTargetKcal(plan: Pick<WeekPlan, 'target'>, day: Pick<MealPlanDay, 'baseKcal' | 'spreadKcal'>): number {
  return (day.baseKcal ?? plan.target.kcal) + (day.spreadKcal ?? 0);
}

export function dayTarget(plan: Pick<WeekPlan, 'target'>, day: Pick<MealPlanDay, 'baseKcal' | 'spreadKcal'>): NutritionTarget {
  return { ...plan.target, kcal: dayTargetKcal(plan, day) };
}

/**
 * Répartit le budget sur la semaine : +bonus les jours d'entraînement, le reste compensé sur les
 * jours de repos. La somme des 7 jours reste égale à 7 × la cible (à l'arrondi près).
 */
export function cyclingTargets(target: Pick<NutritionTarget, 'kcal'>, training: TrainingPlan): number[] {
  const flags = Array.from({ length: 7 }, (_, i) => !!training.days[i]);
  const active = flags.filter(Boolean).length;
  if (active === 0 || active === 7 || training.bonusKcal <= 0) return flags.map(() => target.kcal);

  const rest = 7 - active;
  let bonus = training.bonusKcal;
  const floor = training.floorKcal ?? 0;
  // Le bonus est réduit s'il ferait passer les jours de repos sous le plancher.
  const maxBonus = ((target.kcal - floor) * rest) / active;
  bonus = Math.max(0, Math.min(bonus, maxBonus));
  const restKcal = Math.round((target.kcal - (bonus * active) / rest) / 10) * 10;
  const trainingKcal = Math.round((target.kcal + ((target.kcal - restKcal) * rest) / active) / 10) * 10;
  return flags.map((on) => (on ? trainingKcal : restKcal));
}
