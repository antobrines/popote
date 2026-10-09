import { describe, expect, it } from 'vitest';
import { type WeightPoint, addDays, mondayOf, movingAverage, suggestCalorieAdjustment, summarizeWeight, weeklyAverages, weeklyRate } from '../src/index.js';

const profile = { sex: 'male' as const, age: 27, heightCm: 184 };

/** Série de pesées quotidiennes avec une pente donnée (kg/semaine). */
function series(start: string, days: number, fromKg: number, perWeek: number, noise: number[] = [0]): WeightPoint[] {
  return Array.from({ length: days }, (_, i) => ({
    date: addDays(start, i),
    kg: Math.round((fromKg + (perWeek / 7) * i + noise[i % noise.length]!) * 10) / 10,
  }));
}

describe('suivi du poids', () => {
  it('calcule une moyenne mobile sur 7 jours glissants', () => {
    const points = [
      { date: '2026-10-01', kg: 116 },
      { date: '2026-10-02', kg: 115 },
      { date: '2026-10-03', kg: 117 },
      { date: '2026-10-12', kg: 114 },
    ];
    const average = movingAverage(points);
    expect(average.map((p) => p.kg)).toEqual([116, 115.5, 116, 114]);
  });

  it('calcule les moyennes et variations hebdomadaires', () => {
    const weekly = weeklyAverages([
      { date: '2026-10-05', kg: 116 },
      { date: '2026-10-07', kg: 115.6 },
      { date: '2026-10-12', kg: 115 },
      { date: '2026-10-14', kg: 114.8 },
    ]);
    expect(weekly).toEqual([
      { weekStart: '2026-10-05', avgKg: 115.8, deltaKg: null },
      { weekStart: '2026-10-12', avgKg: 114.9, deltaKg: -0.9 },
    ]);
    expect(mondayOf('2026-10-11')).toBe('2026-10-05');
  });

  it('résume la progression vers l’objectif', () => {
    const summary = summarizeWeight(series('2026-09-01', 42, 116, -0.8), 116, 90, '2026-10-12');
    expect(summary.startKg).toBe(116);
    expect(summary.lostKg).toBeGreaterThan(3.5);
    expect(summary.remainingKg).toBeCloseTo(26 - summary.lostKg, 1);
    expect(summary.progressPct).toBeGreaterThan(10);
    expect(summary.weeklyRateKg).toBeCloseTo(-0.8, 1);
  });
});

describe('suggestion d’ajustement calorique', () => {
  const today = '2026-10-12';
  const base = { today, currentKcal: 2300, goalKg: 90, profile };

  it('ne réagit jamais à une seule pesée', () => {
    const suggestion = suggestCalorieAdjustment({ ...base, points: [{ date: today, kg: 119 }] });
    expect(suggestion.kind).toBe('none');
    expect(suggestion.suggestedKcal).toBe(2300);
    expect(weeklyRate([{ date: today, kg: 119 }], today)).toBeNull();
  });

  it('ignore le bruit quotidien quand la tendance est bonne', () => {
    const points = series('2026-09-14', 29, 116, -0.7, [0.6, -0.5, 0.3, -0.4, 0.8, -0.6, 0.1]);
    expect(suggestCalorieAdjustment({ ...base, points }).kind).toBe('none');
  });

  it('propose une baisse modérée en cas de stagnation prolongée', () => {
    const points = series('2026-09-14', 29, 116, 0);
    const suggestion = suggestCalorieAdjustment({ ...base, points });
    expect(suggestion.kind).toBe('decrease');
    expect(suggestion.suggestedKcal).toBe(2200);
    expect(suggestion.suggestedKcal).toBeGreaterThanOrEqual(suggestion.floorKcal);
  });

  it('ne descend jamais sous le plancher calorique', () => {
    const points = series('2026-09-14', 29, 116, 0);
    const suggestion = suggestCalorieAdjustment({ ...base, points, currentKcal: 1960 });
    expect(suggestion.kind).toBe('none');
    expect(suggestion.suggestedKcal).toBe(1960);
    expect(suggestion.reason).toMatch(/plancher/);
    const near = suggestCalorieAdjustment({ ...base, points, currentKcal: 2000 });
    expect(near.suggestedKcal).toBe(near.floorKcal);
  });

  it('propose d’augmenter si la perte est trop rapide', () => {
    const points = series('2026-09-14', 29, 116, -1.6);
    const suggestion = suggestCalorieAdjustment({ ...base, points });
    expect(suggestion.kind).toBe('increase');
    expect(suggestion.suggestedKcal).toBe(2400);
  });

  it('attend 3 semaines après un ajustement avant d’en proposer un autre', () => {
    const points = series('2026-09-14', 29, 116, 0);
    const suggestion = suggestCalorieAdjustment({ ...base, points, lastAdjustment: '2026-10-01' });
    expect(suggestion.kind).toBe('none');
  });
});
