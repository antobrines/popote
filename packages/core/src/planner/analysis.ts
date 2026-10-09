/**
 * Analyse qualitative d'un programme : alertes d'information, jamais un avis médical.
 */
import type { FoodIndex } from '../nutrition.js';
import type { MealPlanDay, NutritionTarget, Nutrients, PlanWarning } from '../types.js';
import { dayTargetKcal } from './targets.js';

const PRO_ADVICE =
  "Ces repères sont indicatifs et ne remplacent pas un avis médical : si tu gardes ce régime plusieurs semaines, parles-en à un médecin ou à un diététicien.";

export function analyzePlan(
  days: MealPlanDay[],
  target: NutritionTarget,
  foods: FoodIndex,
  averages: Nutrients,
): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  if (days.length === 0) return warnings;

  // Un jour où un repas a été déclaré autrement que prévu ne se juge plus sur le programme.
  const offTarget = days
    .filter((d) => d.meals.every((m) => m.status === 'planned') && Math.abs(d.nutrition.kcal - dayTargetKcal({ target }, d)) > target.toleranceKcal)
    .map((d) => d.index);
  if (offTarget.length > 0) {
    warnings.push({
      code: 'off-target',
      severity: 'warning',
      message: `Certains jours sortent de la tolérance de ±${target.toleranceKcal} kcal : les bornes de portions ne permettent pas de faire mieux avec ces repas.`,
      days: offTarget,
    });
  }

  const lowProtein = days.filter((d) => d.meals.every((m) => m.status === 'planned') && d.nutrition.protein < target.protein - 5).map((d) => d.index);
  if (lowProtein.length > 0) {
    warnings.push({
      code: 'low-protein',
      severity: 'warning',
      message: `La cible de ${target.protein} g de protéines n'est pas atteinte certains jours.`,
      days: lowProtein,
    });
  }

  if (averages.fiber < target.fiberGuide) {
    const lowDays = days.filter((d) => d.nutrition.fiber < target.fiberGuide * 0.8).map((d) => d.index);
    warnings.push({
      code: 'low-fiber',
      severity: 'warning',
      message:
        `Apport moyen en fibres : ${averages.fiber.toLocaleString('fr-FR')} g/jour, sous le repère d'environ ${target.fiberGuide} g. ` +
        'Pistes compatibles avec tes préférences : pâtes et pain complets, flocons d\'avoine, fruits entiers, fruits rouges, amandes. ' +
        PRO_ADVICE,
      days: lowDays,
    });
  }

  const hasVegetables = days.some((d) => d.meals.some((m) => m.items.some((i) => foods.get(i.foodId)?.category === 'legume')));
  if (!hasVegetables) {
    warnings.push({
      code: 'no-vegetables',
      severity: 'info',
      message:
        'Programme sans légumes, comme demandé. Les fruits, compotes, féculents complets et oléagineux couvrent une partie des fibres et micronutriments, ' +
        'mais certains apports (vitamine K, folates, potassium, magnésium, vitamine C) peuvent rester insuffisants. ' +
        PRO_ADVICE,
    });
  }

  const fatShare = (averages.fat * 9) / Math.max(1, averages.kcal);
  if (fatShare < 0.2) {
    warnings.push({
      code: 'low-fat',
      severity: 'info',
      message: `Les lipides représentent ${Math.round(fatShare * 100)} % des calories : c'est bas. Un peu plus d'huile d'olive, de noix ou de saumon aiderait à couvrir les acides gras essentiels.`,
    });
  }

  const fruitPortions =
    days.reduce(
      (sum, d) => sum + d.meals.reduce((s, m) => s + m.items.filter((i) => foods.get(i.foodId)?.category === 'fruit').length, 0),
      0,
    ) / days.length;
  if (fruitPortions < 2) {
    warnings.push({
      code: 'low-fruit',
      severity: 'info',
      message: `Environ ${fruitPortions.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} portion(s) de fruits par jour : viser au moins 2 à 3 aide à compenser l'absence de légumes.`,
    });
  }

  return warnings;
}
