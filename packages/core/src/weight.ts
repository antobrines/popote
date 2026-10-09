/**
 * Suivi du poids : moyenne mobile, tendance hebdomadaire et suggestion prudente d'ajustement.
 * Une pesée isolée ne déclenche jamais rien : seules les tendances sur plusieurs semaines comptent.
 */
import { type BodyProfile, calorieFloor } from './nutrition.js';
import type { CalorieSuggestion, WeightPoint, WeightSummary } from './types.js';
import { addDays, diffDays, mondayOf } from './util.js';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sorted(points: WeightPoint[]): WeightPoint[] {
  return [...points].sort((a, b) => a.date.localeCompare(b.date));
}

/** Moyenne mobile sur `windowDays` jours glissants (une valeur par pesée). */
export function movingAverage(points: WeightPoint[], windowDays = 7): WeightPoint[] {
  const list = sorted(points);
  return list.map((point, index) => {
    const from = addDays(point.date, -(windowDays - 1));
    const window = list.slice(0, index + 1).filter((p) => p.date >= from);
    return { date: point.date, kg: round2(window.reduce((sum, p) => sum + p.kg, 0) / window.length) };
  });
}

/** Moyenne par semaine calendaire (lundi → dimanche) et variation d'une semaine à l'autre. */
export function weeklyAverages(points: WeightPoint[]): WeightSummary['weekly'] {
  const weeks = new Map<string, number[]>();
  for (const p of sorted(points)) {
    const week = mondayOf(p.date);
    weeks.set(week, [...(weeks.get(week) ?? []), p.kg]);
  }
  const list = [...weeks.entries()].map(([weekStart, values]) => ({
    weekStart,
    avgKg: round2(values.reduce((a, b) => a + b, 0) / values.length),
  }));
  return list.map((w, i) => ({ ...w, deltaKg: i === 0 ? null : round2(w.avgKg - list[i - 1]!.avgKg) }));
}

/**
 * Vitesse d'évolution (kg/semaine) : pente de la moyenne mobile sur les `days` derniers jours.
 * Retourne `null` s'il y a trop peu de recul (moins de 14 jours ou de 4 pesées).
 */
export function weeklyRate(points: WeightPoint[], today: string, days = 28): number | null {
  const average = movingAverage(points);
  const from = addDays(today, -days);
  const window = average.filter((p) => p.date >= from && p.date <= today);
  if (window.length < 4) return null;
  const first = window[0]!;
  const last = window[window.length - 1]!;
  const span = diffDays(first.date, last.date);
  if (span < 14) return null;
  return round2(((last.kg - first.kg) / span) * 7);
}

export function summarizeWeight(points: WeightPoint[], startKg: number, goalKg: number, today: string): WeightSummary {
  const list = sorted(points);
  const average = movingAverage(list);
  const current = list.length ? list[list.length - 1]!.kg : null;
  const trend = average.length ? average[average.length - 1]!.kg : null;
  const reference = trend ?? current ?? startKg;
  const totalToLose = startKg - goalKg;
  const lost = round1(startKg - reference);
  return {
    startKg,
    currentKg: current,
    trendKg: trend,
    goalKg,
    lostKg: lost,
    remainingKg: round1(Math.max(0, reference - goalKg)),
    progressPct: totalToLose > 0 ? Math.max(0, Math.min(100, Math.round((lost / totalToLose) * 100))) : 0,
    weeklyRateKg: weeklyRate(list, today),
    movingAverage: average,
    weekly: weeklyAverages(list),
  };
}

export interface SuggestionInput {
  points: WeightPoint[];
  today: string;
  currentKcal: number;
  goalKg: number;
  profile: Pick<BodyProfile, 'sex' | 'age' | 'heightCm'>;
  /** Date du dernier changement de budget calorique : on laisse 3 semaines avant d'en proposer un autre. */
  lastAdjustment?: string;
}

const STEP_KCAL = 100;
const MIN_DAYS_BETWEEN_ADJUSTMENTS = 21;

/**
 * Suggère (sans jamais l'appliquer) un ajustement du budget calorique.
 *
 * - perte trop rapide (> 1 % du poids par semaine) → proposer d'augmenter ;
 * - stagnation (< 0,15 % par semaine) sur 4 semaines → proposer de réduire de 100 kcal,
 *   sans jamais passer sous le plancher (`calorieFloor`).
 */
export function suggestCalorieAdjustment(input: SuggestionInput): CalorieSuggestion {
  const average = movingAverage(input.points);
  const trend = average.length ? average[average.length - 1]!.kg : null;
  const rate = weeklyRate(input.points, input.today);
  const weightKg = trend ?? input.goalKg;
  const floorKcal = calorieFloor({ ...input.profile, weightKg });
  const none = (reason: string, advice?: string): CalorieSuggestion => ({
    kind: 'none',
    currentKcal: input.currentKcal,
    suggestedKcal: input.currentKcal,
    reason,
    floorKcal,
    advice,
  });

  if (trend === null || rate === null) {
    return none('Pas encore assez de pesées : il faut au moins 4 pesées réparties sur 2 semaines pour dégager une tendance.');
  }
  if (input.lastAdjustment && diffDays(input.lastAdjustment.slice(0, 10), input.today) < MIN_DAYS_BETWEEN_ADJUSTMENTS) {
    return none('Budget ajusté récemment : on laisse au moins 3 semaines avant de réévaluer.');
  }
  if (trend <= input.goalKg) {
    return none('Objectif atteint : pense à passer sur un budget de maintien, idéalement avec un professionnel de santé.');
  }

  const ratePct = (rate / trend) * 100;
  if (ratePct < -1) {
    return {
      kind: 'increase',
      currentKcal: input.currentKcal,
      suggestedKcal: input.currentKcal + STEP_KCAL,
      reason: `Tu perds environ ${Math.abs(rate).toLocaleString('fr-FR')} kg par semaine, soit plus de 1 % de ton poids : c'est rapide. Ajouter ${STEP_KCAL} kcal aide à préserver la masse musculaire et à tenir dans la durée.`,
      floorKcal,
      advice: 'Une perte aussi rapide mérite un avis médical si elle se prolonge.',
    };
  }
  if (ratePct > -0.15) {
    const suggested = Math.max(floorKcal, input.currentKcal - STEP_KCAL);
    if (suggested >= input.currentKcal) {
      return none(
        `Ta moyenne stagne (${rate > 0 ? '+' : ''}${rate.toLocaleString('fr-FR')} kg/semaine), mais ton budget est déjà au plancher de ${floorKcal} kcal : l'application ne propose pas de descendre plus bas.`,
        "Vérifie plutôt la pesée des matières grasses et sauces, augmente l'activité, ou demande l'avis d'un professionnel de santé.",
      );
    }
    return {
      kind: 'decrease',
      currentKcal: input.currentKcal,
      suggestedKcal: suggested,
      reason: `Ta moyenne mobile évolue de ${rate > 0 ? '+' : ''}${rate.toLocaleString('fr-FR')} kg par semaine sur les 4 dernières semaines : la perte stagne. Réduire de ${input.currentKcal - suggested} kcal peut la relancer.`,
      floorKcal,
      advice: "Avant de réduire, vérifie que les quantités réellement mangées correspondent bien au programme.",
    };
  }
  return none(`Progression régulière : ${rate.toLocaleString('fr-FR')} kg par semaine en moyenne. Aucun ajustement nécessaire.`);
}
