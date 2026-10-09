/**
 * Bilan de la semaine : ce qui était prévu, ce qui a été fait, et où ça mène.
 */
import type { Nutrients, WeekPlan, WeightSummary } from '../types.js';
import { addDays } from '../util.js';
import { dayTargetKcal } from './targets.js';

export interface GoalEstimate {
  weeks: number;
  /** Date ISO estimée d'arrivée à l'objectif. */
  date: string;
}

export interface WeekReview {
  weekStart: string;
  /** Repas échus : ceux des jours passés, et ceux d'aujourd'hui déjà déclarés. */
  mealsDue: number;
  eaten: number;
  partial: number;
  replaced: number;
  skipped: number;
  /** Repas des jours passés restés sans déclaration. */
  undeclared: number;
  /** Part des repas échus mangés comme prévu (0–100), ou `null` si rien n'est encore échu. */
  adherencePct: number | null;
  daysLogged: number;
  /** Jours déclarés dont le total réel est dans la tolérance. */
  daysOnTarget: number;
  avgKcal: number | null;
  avgProtein: number | null;
  /** Cible moyenne des jours comptés (jours d'entraînement et lissages compris). */
  targetKcal: number;
  targetProtein: number;
  /** Variation de la moyenne hebdomadaire du poids (kg), ou `null`. */
  weightDeltaKg: number | null;
  weeklyRateKg: number | null;
  goal: GoalEstimate | null;
  plannedCost: number | null;
  actualCost: number | null;
}

/**
 * Date estimée d'arrivée à l'objectif, au rythme actuel de la moyenne mobile.
 * `null` tant que la tendance n'est pas mesurable ou ne va pas vers l'objectif.
 */
export function estimateGoalDate(summary: Pick<WeightSummary, 'weeklyRateKg' | 'remainingKg' | 'trendKg'>, today: string): GoalEstimate | null {
  const rate = summary.weeklyRateKg;
  if (rate === null || summary.trendKg === null || summary.remainingKg <= 0) return null;
  // En dessous de 100 g par semaine, l'estimation n'a pas de sens (plusieurs années).
  if (rate > -0.1) return null;
  const weeks = Math.ceil(summary.remainingKg / Math.abs(rate));
  return { weeks, date: addDays(today, weeks * 7) };
}

export interface ReviewInput {
  plan: Pick<WeekPlan, 'weekStart' | 'days' | 'target'>;
  entries: { date: string; nutrition: Nutrients }[];
  today: string;
  weightSummary?: WeightSummary | null;
  plannedCost?: number | null;
  actualCost?: number | null;
}

export function reviewWeek(input: ReviewInput): WeekReview {
  const { plan, today } = input;
  const dueDays = plan.days.filter((d) => d.date <= today);
  // Les repas d'aujourd'hui encore prévus ne sont pas en retard : la journée n'est pas finie.
  const meals = dueDays.flatMap((d) => (d.date < today ? d.meals : d.meals.filter((m) => m.status !== 'planned')));
  const count = (status: string) => meals.filter((m) => m.status === status).length;
  const eaten = count('eaten');

  const byDay = new Map<string, Nutrients>();
  for (const entry of input.entries) {
    if (entry.date < plan.weekStart || entry.date > addDays(plan.weekStart, 6)) continue;
    const sum = byDay.get(entry.date) ?? { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    sum.kcal += entry.nutrition.kcal;
    sum.protein += entry.nutrition.protein;
    byDay.set(entry.date, sum);
  }
  // Un jour compte dans les moyennes s'il est terminé (plus aucun repas en attente) : une journée
  // en cours tirerait la moyenne vers le bas.
  const complete = dueDays.filter((d) => byDay.has(d.date) && d.meals.every((m) => m.status !== 'planned'));
  const totals = complete.map((d) => byDay.get(d.date)!);
  const avg = (pick: (n: Nutrients) => number) => (totals.length ? Math.round(totals.reduce((s, n) => s + pick(n), 0) / totals.length) : null);
  const daysOnTarget = complete.filter((d) => Math.abs(byDay.get(d.date)!.kcal - dayTargetKcal(plan, d)) <= plan.target.toleranceKcal).length;

  const weekly = input.weightSummary?.weekly ?? [];
  const thisWeek = weekly.find((w) => w.weekStart === plan.weekStart);

  return {
    weekStart: plan.weekStart,
    mealsDue: meals.length,
    eaten,
    partial: count('partial'),
    replaced: count('replaced'),
    skipped: count('skipped'),
    undeclared: count('planned'),
    adherencePct: meals.length ? Math.round((eaten / meals.length) * 100) : null,
    daysLogged: complete.length,
    daysOnTarget,
    avgKcal: avg((n) => n.kcal),
    avgProtein: avg((n) => n.protein),
    targetKcal: complete.length ? Math.round(complete.reduce((sum, d) => sum + dayTargetKcal(plan, d), 0) / complete.length) : plan.target.kcal,
    targetProtein: plan.target.protein,
    weightDeltaKg: thisWeek?.deltaKg ?? null,
    weeklyRateKg: input.weightSummary?.weeklyRateKg ?? null,
    goal: input.weightSummary ? estimateGoalDate(input.weightSummary, today) : null,
    plannedCost: input.plannedCost ?? null,
    actualCost: input.actualCost ?? null,
  };
}
