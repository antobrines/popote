import { describe, expect, it } from 'vitest';
import {
  CIQUAL_MISSING,
  CIQUAL_VALUES,
  DEMO_MEALS,
  DEMO_PREFS,
  DEMO_TARGET,
  SEED_FOODS,
  SEED_TEMPLATES,
  type DayLock,
  type PlannerInput,
  type WeekPlan,
  applyWeekSpread,
  baseSignature,
  buildCustomTemplate,
  buildShoppingList,
  compactLabel,
  compactMeal,
  cookOncePairs,
  countPossibleDishes,
  cyclingTargets,
  dayTargetKcal,
  defaultStructure,
  estimateGoalDate,
  generateWeek,
  indexFoods,
  ingredientLabel,
  mealAlternatives,
  optimizePackages,
  planTable,
  planTableText,
  replaceMeal,
  reviewWeek,
  swapMeals,
  wasteReport,
} from '../src/index.js';

const foods = indexFoods(SEED_FOODS);

function makeInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    weekStart: '2026-10-12',
    seed: 4321,
    foods: SEED_FOODS,
    templates: SEED_TEMPLATES,
    target: DEMO_TARGET,
    structure: defaultStructure(DEMO_MEALS),
    prefs: DEMO_PREFS,
    away: Array(7).fill('none'),
    inventory: {},
    previousSignatures: [],
    ...overrides,
  };
}

const allMeals = (plan: WeekPlan) => plan.days.flatMap((d) => d.meals);
const onTarget = (plan: WeekPlan) => plan.days.every((d) => Math.abs(d.nutrition.kcal - dayTargetKcal(plan, d)) <= plan.target.toleranceKcal);

describe('saveurs', () => {
  it('décline les plats simples avec des assaisonnements comptés comme de vrais ingrédients', () => {
    const seasoned = [1, 2, 3, 4].flatMap((seed) => allMeals(generateWeek(makeInput({ seed })))).filter((m) => m.items.some((i) => i.slotKey === 'seasoning'));
    expect(seasoned.length).toBeGreaterThan(4);
    for (const meal of seasoned) {
      const spice = meal.items.find((i) => i.slotKey === 'seasoning')!;
      expect(foods.get(spice.foodId)!.category).toBe('epice');
      // L'épice figure dans le nom et dans l'identité du plat, pas dans son identité « de base ».
      expect(meal.name.toLowerCase()).toContain(foods.get(spice.foodId)!.shortName);
      expect(meal.signature).toContain('~');
      expect(baseSignature(meal.templateId, meal.items)).not.toContain(spice.foodId);
    }
  });

  it('affiche une mesure ménagère pour les épices', () => {
    expect(ingredientLabel(foods.get('epices-cajun')!, 3)).toBe("3 g d'épices cajun (≈ 1 c. à café)");
    expect(ingredientLabel(foods.get('jus-citron')!, 15, true)).toBe('15 ml de jus de citron (≈ 1 c. à soupe)');
  });

  it('multiplie les variantes sans gonfler le nombre de plats de base', () => {
    const count = countPossibleDishes(SEED_FOODS, SEED_TEMPLATES, { excludedFoods: [], excludedTags: [], bannedTemplates: [] });
    expect(count.mainsHomeFlavored).toBeGreaterThan(count.mainsHome * 2);
  });

  it('ne répète pas le même plat de base dans la semaine sous une autre épice', () => {
    for (const seed of [5, 6, 7]) {
      const plan = generateWeek(makeInput({ seed }));
      const bases = allMeals(plan)
        .filter((m) => m.slot !== 'collation')
        .map((m) => baseSignature(m.templateId, m.items));
      const repeats = bases.length - new Set(bases).size;
      expect(repeats).toBeLessThanOrEqual(1);
    }
  });

  it('« je n’aime pas ce repas » ne repropose pas le même plat avec une autre épice', () => {
    const input = makeInput({ seed: 11 });
    const plan = generateWeek(input);
    for (const day of plan.days.slice(0, 4)) {
      const meal = day.meals[0]!;
      const base = baseSignature(meal.templateId, meal.items);
      const replaced = replaceMeal(input, plan, day.index, meal.id).days[day.index]!.meals[0]!;
      expect(baseSignature(replaced.templateId, replaced.items)).not.toBe(base);
      const options = mealAlternatives(input, plan, day.index, meal.id, 3);
      const optionBases = options.map((o) => baseSignature(o.templateId, o.items));
      expect(new Set(optionBases).size).toBe(options.length);
      expect(optionBases).not.toContain(base);
    }
  });
});

describe('cuisiner une fois, manger deux fois', () => {
  const input = makeInput({ seed: 21, prefs: { ...DEMO_PREFS, cookOnce: true } });
  const plan = generateWeek(input);

  it('fait du dîner le déjeuner du lendemain, quantités ajustées à chaque journée', () => {
    const pairs = cookOncePairs(plan);
    expect(pairs.length).toBeGreaterThanOrEqual(4);
    for (const pair of pairs) {
      const dinner = plan.days[pair.cookDay]!.meals.find((m) => m.id === pair.cookMealId)!;
      const lunch = plan.days[pair.eatDay]!.meals.find((m) => m.id === pair.eatMealId)!;
      expect(pair.eatDay).toBe(pair.cookDay + 1);
      expect(lunch.slot).toBe('dejeuner');
      expect(lunch.items.map((i) => i.foodId)).toEqual(dinner.items.map((i) => i.foodId));
      expect(SEED_TEMPLATES.find((t) => t.id === dinner.templateId)!.batchFriendly).toBe(true);
    }
    expect(onTarget(plan)).toBe(true);
  });

  it('ne s’applique pas sans le réglage', () => {
    expect(cookOncePairs(generateWeek(makeInput({ seed: 21 }))).length).toBeLessThanOrEqual(1);
  });
});

describe('repas verrouillés et échanges', () => {
  it('conserve les repas verrouillés quand on régénère la semaine', () => {
    const first = generateWeek(makeInput({ seed: 31 }));
    const lockedLunch = { ...first.days[2]!.meals[0]!, locked: true };
    const lockedDinner = { ...first.days[5]!.meals[2]!, locked: true };
    const keep = first.days.map((d) => d.meals.map((m) => (m.id === lockedLunch.id ? lockedLunch : m.id === lockedDinner.id ? lockedDinner : null)));
    const second = generateWeek(makeInput({ seed: 32, keep }));

    expect(second.days[2]!.meals[0]!.id).toBe(lockedLunch.id);
    expect(second.days[2]!.meals[0]!.signature).toBe(lockedLunch.signature);
    expect(second.days[2]!.meals[0]!.locked).toBe(true);
    expect(second.days[5]!.meals[2]!.signature).toBe(lockedDinner.signature);
    // Le reste de la semaine change bel et bien.
    const changed = second.days.flatMap((d, i) => d.meals.filter((m, j) => m.signature !== first.days[i]!.meals[j]!.signature)).length;
    expect(changed).toBeGreaterThan(8);
    expect(onTarget(second)).toBe(true);
  });

  it('échange deux repas et rééquilibre les deux journées', () => {
    const input = makeInput({ seed: 33 });
    const plan = generateWeek(input);
    const a = plan.days[1]!.meals[2]!;
    const b = plan.days[4]!.meals[0]!;
    const next = swapMeals(input, plan, { dayIndex: 1, mealId: a.id }, { dayIndex: 4, mealId: b.id });
    expect(next.days[1]!.meals[2]!.signature).toBe(b.signature);
    expect(next.days[1]!.meals[2]!.slot).toBe('diner');
    expect(next.days[4]!.meals[0]!.signature).toBe(a.signature);
    expect(next.days[4]!.meals[0]!.slot).toBe('dejeuner');
    expect(onTarget(next)).toBe(true);
    expect(() => swapMeals(input, plan, { dayIndex: 1, mealId: a.id }, { dayIndex: 4, mealId: plan.days[4]!.meals[1]!.id })).toThrow(/principal/);
  });
});

describe('jours d’entraînement', () => {
  it('ajoute des calories ces jours-là sans changer la moyenne de la semaine', () => {
    const days = [true, false, true, false, true, false, false];
    const targets = cyclingTargets({ kcal: 2300 }, { days, bonusKcal: 200, floorKcal: 1960 });
    expect(targets).toEqual([2500, 2150, 2500, 2150, 2500, 2150, 2150]);
    expect(targets.reduce((a, b) => a + b, 0)).toBe(7 * 2300);
  });

  it('réduit le bonus plutôt que de passer sous le plancher', () => {
    const targets = cyclingTargets({ kcal: 2300 }, { days: [true, true, true, true, true, false, false], bonusKcal: 300, floorKcal: 1960 });
    expect(Math.min(...targets)).toBeGreaterThanOrEqual(1960);
    expect(Math.abs(targets.reduce((a, b) => a + b, 0) - 7 * 2300)).toBeLessThanOrEqual(70);
    expect(cyclingTargets({ kcal: 2300 }, { days: Array(7).fill(false), bonusKcal: 200 })).toEqual(Array(7).fill(2300));
  });

  it('génère chaque journée sur sa propre cible', () => {
    const training = { days: [true, false, true, false, true, false, false], bonusKcal: 200, floorKcal: 1960 };
    const plan = generateWeek(makeInput({ seed: 41, training }));
    expect(plan.days.map((d) => !!d.training)).toEqual(training.days);
    expect(plan.days[0]!.baseKcal).toBe(2500);
    expect(plan.days[1]!.baseKcal).toBe(2150);
    expect(onTarget(plan)).toBe(true);
    expect(Math.abs(plan.averages.kcal - 2300)).toBeLessThanOrEqual(15);
    for (const day of plan.days) expect(day.nutrition.protein).toBeGreaterThanOrEqual(172);
    expect(plan.warnings.map((w) => w.code)).not.toContain('off-target');
  });
});

describe('repas libre lissé sur la semaine', () => {
  const input = makeInput({ seed: 51 });
  const plan = generateWeek(input);
  const options = { maxPerDayKcal: 150, floorKcal: 1960 };
  const today = plan.days[1]!.date;

  function withFreeMeal(kcal: number): { plan: WeekPlan; intake: Record<number, DayLock> } {
    const copy: WeekPlan = structuredClone(plan);
    const lunch = copy.days[1]!.meals[0]!;
    lunch.status = 'replaced';
    lunch.free = { kcal, protein: 60, label: 'Restaurant' };
    return { plan: copy, intake: { 1: { lockedMealIds: [lunch.id], consumed: { kcal, protein: 60, carbs: 0, fat: 0, fiber: 0 } } } };
  }

  it('répartit l’excédent sur les jours suivants, par petites touches bornées', () => {
    const free = withFreeMeal(1900);
    const { plan: next, report } = applyWeekSpread(input, free.plan, free.intake, today, options);
    expect(report.surplusKcal).toBeGreaterThan(200);
    expect(report.absorbedKcal).toBeGreaterThan(0);
    expect(report.absorbedKcal).toBeLessThanOrEqual(report.surplusKcal + 10);
    // Ni les jours passés ni le jour même ne sont réduits ; les suivants le sont, jamais trop.
    expect(next.days[0]!.spreadKcal).toBeUndefined();
    expect(next.days[1]!.spreadKcal).toBeUndefined();
    for (const day of next.days.slice(2)) {
      expect(day.spreadKcal).toBeLessThan(0);
      expect(day.spreadKcal).toBeGreaterThanOrEqual(-150);
      expect(dayTargetKcal(next, day)).toBeGreaterThanOrEqual(1960);
      expect(Math.abs(day.nutrition.kcal - dayTargetKcal(next, day))).toBeLessThanOrEqual(50);
      expect(day.nutrition.protein).toBeGreaterThanOrEqual(170);
    }
    // Le reste du jour même est réduit autant que les portions le permettent.
    const sameDayRest = next.days[1]!.meals.slice(1).reduce((s, m) => s + m.nutrition.kcal, 0);
    const before = plan.days[1]!.meals.slice(1).reduce((s, m) => s + m.nutrition.kcal, 0);
    expect(sameDayRest).toBeLessThan(before);
  });

  it('ne lisse rien pour un écart dans la tolérance, et s’annule avec le repas libre', () => {
    const lunchKcal = plan.days[1]!.meals[0]!.nutrition.kcal;
    const small = withFreeMeal(lunchKcal + 20);
    expect(applyWeekSpread(input, small.plan, small.intake, today, options).report.absorbedKcal).toBe(0);

    const free = withFreeMeal(1900);
    const spread = applyWeekSpread(input, free.plan, free.intake, today, options).plan;
    const undone: WeekPlan = structuredClone(spread);
    undone.days[1]!.meals[0]!.status = 'planned';
    delete undone.days[1]!.meals[0]!.free;
    const restored = applyWeekSpread(input, undone, {}, today, options).plan;
    for (const day of restored.days) {
      expect(day.spreadKcal).toBeUndefined();
      if (day.index >= 1) expect(Math.abs(day.nutrition.kcal - 2300)).toBeLessThanOrEqual(50);
    }
  });

  it('respecte le plancher quand le budget en est déjà proche', () => {
    const free = withFreeMeal(2500);
    const { plan: next } = applyWeekSpread(input, free.plan, free.intake, today, { maxPerDayKcal: 400, floorKcal: 2250 });
    for (const day of next.days.slice(2)) expect(dayTargetKcal(next, day)).toBeGreaterThanOrEqual(2250);
  });
});

describe('anti-gaspillage', () => {
  it('arrondit les viandes fraîches à des barquettes entières sans sortir des cibles', () => {
    let improved = 0;
    for (const seed of [61, 62, 63, 64, 65, 66]) {
      const surplus = (plan: WeekPlan) => {
        let total = 0;
        for (const id of ['poulet', 'dinde', 'steak-hache-5', 'rumsteck', 'haut-de-cuisse-poulet', 'saumon']) {
          const need = allMeals(plan).flatMap((m) => m.items).filter((i) => i.foodId === id).reduce((s, i) => s + i.grams, 0);
          if (need > 0) total += optimizePackages(need, foods.get(id)!.packages, 'cheapest').boughtG - need;
        }
        return total;
      };
      const rounded = generateWeek(makeInput({ seed }));
      const raw = generateWeek(makeInput({ seed, roundToPacks: false }));
      expect(onTarget(rounded)).toBe(true);
      for (const day of rounded.days) expect(day.nutrition.protein).toBeGreaterThanOrEqual(175);
      expect(surplus(rounded)).toBeLessThanOrEqual(surplus(raw));
      if (surplus(rounded) < surplus(raw)) improved++;
    }
    expect(improved).toBeGreaterThanOrEqual(3);
  });

  it('liste les restes périssables à prévoir', () => {
    const plan = generateWeek(makeInput({ seed: 67 }));
    const list = buildShoppingList({ plan, foods, inventory: {}, packages: {}, strategy: 'cheapest' });
    const report = wasteReport(list, foods);
    for (const line of report) {
      expect(foods.get(line.foodId)!.perishable).toBe(true);
      expect(line.leftoverG).toBeGreaterThanOrEqual(30);
    }
    expect(report.every((l) => !['riz', 'pates', 'huile-olive'].includes(l.foodId))).toBe(true);
  });
});

describe('repas à emporter', () => {
  const away = Array(7).fill('full');

  it('ne propose des repas cuisinés la veille que si on l’accepte', () => {
    const strict = generateWeek(makeInput({ seed: 71, away }));
    for (const meal of allMeals(strict)) {
      expect(SEED_TEMPLATES.find((t) => t.id === meal.templateId)!.prepAhead).toBeFalsy();
      for (const i of meal.items) expect(foods.get(i.foodId)!.portable && foods.get(i.foodId)!.noCook).toBe(true);
    }
    const relaxed = generateWeek(makeInput({ seed: 71, away, prefs: { ...DEMO_PREFS, awayPrepAhead: true } }));
    const boxes = allMeals(relaxed).filter((m) => SEED_TEMPLATES.find((t) => t.id === m.templateId)!.prepAhead);
    expect(boxes.length).toBeGreaterThan(0);
    expect(onTarget(strict) && onTarget(relaxed)).toBe(true);
  });

  it('offre plus de formules qu’avant', () => {
    const base = { excludedFoods: ['wrap'], excludedTags: ['legume', 'poisson'], bannedTemplates: [] };
    expect(countPossibleDishes(SEED_FOODS, SEED_TEMPLATES, base).mainsAway).toBeGreaterThanOrEqual(8);
    expect(countPossibleDishes(SEED_FOODS, SEED_TEMPLATES, { ...base, awayPrepAhead: true }).mainsAway).toBeGreaterThanOrEqual(14);
  });
});

describe('recettes personnelles', () => {
  const recipe = {
    name: 'Mon poulet coco',
    meal: 'main' as const,
    away: false,
    ingredients: [
      { foodId: 'poulet', role: 'protein' as const },
      { foodId: 'riz', role: 'energy' as const },
      { foodId: 'creme-legere', role: 'fixed' as const, grams: 60 },
      { foodId: 'curry-poudre', role: 'fixed' as const, grams: 4 },
    ],
    dessert: true,
    steps: ['Saisir le poulet.', 'Ajouter la crème {et le curry}.'],
    prepMin: 5,
    cookMin: 15,
  };

  it('devient un modèle de repas dosé par le moteur', () => {
    const template = buildCustomTemplate(recipe, foods);
    expect(template.id).toBe('perso-mon-poulet-coco');
    expect(template.custom).toBe(true);
    expect(template.steps.join(' ')).not.toMatch(/\{et/);
    const others = SEED_TEMPLATES.filter((t) => t.slots.includes('dejeuner') && t.context === 'home').map((t) => t.id);
    const plan = generateWeek(makeInput({ seed: 81, templates: [...SEED_TEMPLATES, template], prefs: { ...DEMO_PREFS, bannedTemplates: others } }));
    const mine = allMeals(plan).filter((m) => m.templateId === template.id);
    expect(mine.length).toBe(14);
    expect(mine[0]!.name).toBe('Mon poulet coco');
    expect(mine[0]!.items.find((i) => i.foodId === 'creme-legere')!.grams).toBe(60);
    expect(onTarget(plan)).toBe(true);
  });

  it('sort dans la semaine générée, sans l’envahir', () => {
    const template = buildCustomTemplate(recipe, foods);
    for (const seed of [81, 82, 83, 84, 85, 86]) {
      for (const cookOnce of [false, true]) {
        const plan = generateWeek(makeInput({ seed, templates: [...SEED_TEMPLATES, template], prefs: { ...DEMO_PREFS, cookOnce } }));
        const uses = allMeals(plan).filter((m) => m.templateId === template.id).length;
        expect(uses, `graine ${seed}, cuisiner une fois = ${cookOnce}`).toBeGreaterThanOrEqual(1);
        // Une fois, ou deux quand le dîner est reconduit au déjeuner du lendemain.
        expect(uses).toBeLessThanOrEqual(cookOnce ? 2 : 1);
        expect(onTarget(plan)).toBe(true);
      }
    }
  });

  it('refuse une recette incomplète avec un message clair', () => {
    expect(() => buildCustomTemplate({ ...recipe, name: ' ' }, foods)).toThrow(/nom/);
    expect(() => buildCustomTemplate({ ...recipe, ingredients: [] }, foods)).toThrow(/ingrédient/);
    expect(() => buildCustomTemplate({ ...recipe, ingredients: [{ foodId: 'inconnu', role: 'fixed', grams: 10 }] }, foods)).toThrow(/inconnu/);
    expect(() => buildCustomTemplate({ ...recipe, ingredients: [{ foodId: 'beurre', role: 'fixed' }] }, foods)).toThrow(/quantité/);
  });

  it('marque « à préparer la veille » une recette à emporter qui se cuisine', () => {
    expect(buildCustomTemplate({ ...recipe, away: true }, foods).prepAhead).toBe(true);
    const cold = buildCustomTemplate({ ...recipe, away: true, ingredients: [{ foodId: 'poulet-roti-eminces', role: 'protein' }, { foodId: 'pain-complet', role: 'energy' }] }, foods);
    expect(cold.prepAhead).toBeUndefined();
  });
});

describe('style simple : des assiettes sans recette', () => {
  const simplePrefs = { ...DEMO_PREFS, style: 'simple' as const };
  const simple = (seed: number, overrides: Partial<PlannerInput> = {}) => generateWeek(makeInput({ seed, prefs: simplePrefs, ...overrides }));
  const mains = (plan: WeekPlan) => allMeals(plan).filter((m) => m.slot !== 'collation');
  const food = (id: string) => foods.get(id)!;

  it('ne tire que des assiettes simples à la maison, à la cible chaque jour', () => {
    for (const seed of [201, 202, 203, 204, 205, 206]) {
      const plan = simple(seed);
      expect(plan.style).toBe('simple');
      for (const meal of allMeals(plan)) expect(meal.templateId, meal.name).toMatch(/^simple-/);
      expect(onTarget(plan), `graine ${seed}`).toBe(true);
      for (const day of plan.days) expect(day.nutrition.protein).toBeGreaterThanOrEqual(172);
      expect(plan.warnings.map((w) => w.code)).not.toContain('off-target');
    }
  });

  it('garde une vraie portion de viande, un féculent, du beurre, et peu d’accompagnements', () => {
    for (const seed of [207, 208, 209]) {
      for (const meal of mains(simple(seed))) {
        const keys = meal.items.map((i) => i.slotKey);
        expect(keys.slice(0, 2)).toEqual(['protein', 'starch']);
        expect(keys).toContain('fat');
        expect(keys).not.toContain('seasoning');
        expect(meal.items[0]!.grams).toBeGreaterThanOrEqual(150);
        expect(meal.items.length).toBeLessThanOrEqual(7);
        // Du beurre, pas d'huile, tant que le beurre n'est pas refusé.
        expect(meal.items.find((i) => i.slotKey === 'fat')!.foodId).toBe('beurre');
      }
    }
  });

  it('met des œufs le soir seulement : trois avec des pommes de terre, deux sinon', () => {
    let withEggs = 0;
    for (const seed of [210, 211, 212, 213]) {
      for (const meal of mains(simple(seed))) {
        const eggs = meal.items.find((i) => i.foodId === 'oeufs');
        if (!eggs) continue;
        withEggs++;
        expect(meal.slot).toBe('diner');
        const starch = meal.items.find((i) => i.slotKey === 'starch')!.foodId;
        expect(eggs.grams / food('oeufs').piece!.grams).toBe(starch === 'pommes-de-terre' ? 3 : 2);
      }
    }
    expect(withEggs).toBeGreaterThan(6);
  });

  it('écrit chaque ingrédient de façon compacte', () => {
    expect(compactLabel(food('poulet'), 250)).toBe('250 g poulet');
    expect(compactLabel(food('riz'), 100)).toBe('100 g riz cru');
    expect(compactLabel(food('pates'), 120)).toBe('120 g pâtes crues');
    expect(compactLabel(food('semoule'), 100)).toBe('100 g semoule crue');
    expect(compactLabel(food('pommes-de-terre'), 300)).toBe('300 g pommes de terre crues');
    expect(compactLabel(food('oeufs'), 165)).toBe('3 œufs');
    expect(compactLabel(food('compote'), 100)).toBe('1 compote');
    expect(compactLabel(food('yaourt'), 125)).toBe('1 yaourt');
    expect(compactLabel(food('banane'), 120)).toBe('1 banane');
    expect(compactLabel(food('barre-proteinee'), 55)).toBe('1 barre protéinée');
    // Ce qui se dose plutôt qu'il ne se compte reste en grammes.
    expect(compactLabel(food('skyr'), 140)).toBe('140 g skyr');
    expect(compactLabel(food('whey'), 30)).toBe('30 g whey');
    expect(compactLabel(food('pain-complet'), 70)).toBe('70 g pain complet');
    expect(compactLabel(food('fromage-blanc'), 250)).toBe('250 g fromage blanc');
    expect(compactLabel(food('lait'), 250)).toBe('250 ml lait');
  });

  it('écrit un repas sur une ligne et la semaine en tableau Jour / Midi / Collation / Soir', () => {
    const plan = simple(214);
    const lunch = plan.days[0]!.meals[0]!;
    const line = compactMeal(lunch, foods);
    expect(line.split(' + ')).toHaveLength(lunch.items.length);
    expect(line).toMatch(/^\d+ g [^+]+ \+ \d+ g [^+]+ (cru|crue|crues) \+ /);

    const table = planTable(plan, foods);
    expect(table.columns.map((c) => c.label)).toEqual(['Midi', 'Collation', 'Soir']);
    expect(table.rows.map((r) => r.day)).toEqual(['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']);

    const lines = planTableText(plan, foods).split('\n');
    expect(lines[0]).toBe('Jour\tMidi\tCollation\tSoir');
    expect(lines).toHaveLength(8);
    for (const row of lines.slice(1)) {
      const cells = row.split('\t');
      expect(cells).toHaveLength(4);
      for (const cell of cells.slice(1)) expect(cell).toContain(' + ');
    }
  });

  it('note un repas libre ou sauté dans le tableau', () => {
    const plan = structuredClone(simple(215));
    plan.days[0]!.meals[0]!.free = { kcal: 1300, protein: 50, label: 'Restaurant' };
    plan.days[0]!.meals[0]!.status = 'replaced';
    plan.days[0]!.meals[1]!.status = 'skipped';
    const row = planTable(plan, foods).rows[0]!;
    // L'espace des milliers est une espace fine insécable en français.
    expect(row.cells[0]).toMatch(/^Restaurant \(≈ 1\s300 kcal\)$/);
    expect(row.cells[1]).toBe('—');
  });

  it('garde les repas à emporter les jours hors domicile', () => {
    const away = ['full', 'none', 'none', 'none', 'none', 'none', 'none'] as PlannerInput['away'];
    const plan = simple(216, { away });
    for (const meal of plan.days[0]!.meals) {
      expect(meal.context).toBe('away');
      expect(meal.templateId).not.toMatch(/^simple-/);
    }
    for (const meal of plan.days[1]!.meals) expect(meal.templateId).toMatch(/^simple-/);
    expect(onTarget(plan)).toBe(true);
  });

  it('ne mélange pas les styles : aucune assiette simple en style cuisiné, et l’inverse', () => {
    for (const meal of allMeals(generateWeek(makeInput({ seed: 217 })))) expect(meal.templateId).not.toMatch(/^simple-/);
    const cuisine = generateWeek(makeInput({ seed: 217, prefs: { ...DEMO_PREFS, style: 'cuisine' } }));
    expect(cuisine.style).toBe('cuisine');
    for (const meal of allMeals(cuisine)) expect(meal.templateId).not.toMatch(/^simple-/);
  });

  it('propose des remplacements du même style', () => {
    const plan = simple(218);
    const dinner = plan.days[2]!.meals[2]!;
    const input = makeInput({ seed: 218, prefs: simplePrefs });
    const options = mealAlternatives(input, plan, 2, dinner.id);
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) expect(option.templateId).toMatch(/^simple-/);
    const next = replaceMeal(input, plan, 2, dinner.id);
    expect(next.days[2]!.meals[2]!.templateId).toMatch(/^simple-/);
    expect(next.days[2]!.meals[2]!.signature).not.toBe(dinner.signature);
  });

  it('fonctionne avec « cuisiner une fois » et avec les jours d’entraînement', () => {
    const plan = simple(219, { prefs: { ...simplePrefs, cookOnce: true }, training: { days: [true, false, true, false, true, false, false], bonusKcal: 200 } });
    expect(cookOncePairs(plan).length).toBeGreaterThanOrEqual(2);
    expect(onTarget(plan)).toBe(true);
  });

  it('sort aussi les recettes de l’utilisateur', () => {
    const custom = buildCustomTemplate(
      { name: 'Mon chili', meal: 'main', away: false, dessert: false, prepMin: 5, cookMin: 20, steps: ['Mijoter.'], ingredients: [{ foodId: 'steak-hache-5', role: 'protein' }, { foodId: 'riz', role: 'energy' }, { foodId: 'sauce-tomate', role: 'fixed', grams: 150 }] },
      foods,
    );
    const plan = simple(220, { templates: [...SEED_TEMPLATES, custom] });
    expect(allMeals(plan).some((m) => m.templateId === custom.id)).toBe(true);
  });

  it('se rabat sur tout le catalogue si aucun modèle simple n’est disponible', () => {
    const plan = simple(221, { templates: SEED_TEMPLATES.filter((t) => !t.styles) });
    expect(allMeals(plan)).toHaveLength(21);
    expect(onTarget(plan)).toBe(true);
  });

  it('compte les plats possibles par style, sans changer le compte du style cuisiné', () => {
    const base = { excludedFoods: [], excludedTags: ['legume', 'poisson'], bannedTemplates: [] };
    const cuisine = countPossibleDishes(SEED_FOODS, SEED_TEMPLATES, base);
    expect(cuisine).toEqual(countPossibleDishes(SEED_FOODS, SEED_TEMPLATES.filter((t) => !t.styles), base));
    const simpleCount = countPossibleDishes(SEED_FOODS, SEED_TEMPLATES, { ...base, style: 'simple' });
    // 5 viandes × 5 féculents, avec ou sans œufs.
    expect(simpleCount.mainsHome).toBe(50);
    expect(simpleCount.snacksHome).toBeGreaterThanOrEqual(3);
    expect(simpleCount.mainsAway).toBe(cuisine.mainsAway);
  });
});

describe('valeurs nutritionnelles de référence (table Ciqual)', () => {
  it('couvre tout le catalogue : chaque aliment vient de la table ou est signalé comme absent', () => {
    for (const food of SEED_FOODS) {
      const inTable = food.id in CIQUAL_VALUES;
      expect(inTable !== food.id in CIQUAL_MISSING, food.id).toBe(true);
      expect(!!food.ciqual, food.id).toBe(inTable);
    }
    const ids = new Set(SEED_FOODS.map((f) => f.id));
    for (const id of [...Object.keys(CIQUAL_VALUES), ...Object.keys(CIQUAL_MISSING)]) expect(ids.has(id), id).toBe(true);
    expect(Object.keys(CIQUAL_VALUES).length).toBeGreaterThanOrEqual(50);
  });

  it('applique exactement les valeurs de la table aux aliments du catalogue', () => {
    const chicken = foods.get('poulet')!;
    expect(chicken.ciqual).toMatchObject({ code: '36017', label: 'Poulet, filet, sans peau, cru' });
    expect(chicken.per100).toEqual({ kcal: 110, protein: 23.4, carbs: 0, fat: 1.5, fiber: 0 });
    for (const [id, reference] of Object.entries(CIQUAL_VALUES)) expect(foods.get(id)!.per100, id).toEqual(reference.per100);
    // Sans équivalent dans la table : une moyenne d'étiquettes, sans référence affichée.
    expect(foods.get('skyr')!.ciqual).toBeUndefined();
  });

  it('garde des valeurs cohérentes : l’énergie correspond aux macronutriments', () => {
    for (const food of SEED_FOODS) {
      const { kcal, protein, carbs, fat, fiber } = food.per100;
      const expected = 4 * protein + 4 * carbs + 9 * fat + 2 * fiber;
      expect(Math.abs(expected - kcal), `${food.id} : ${kcal} kcal annoncées, ${Math.round(expected)} calculées`).toBeLessThanOrEqual(Math.max(12, kcal * 0.08));
    }
  });
});

describe('bilan de la semaine', () => {
  const plan = generateWeek(makeInput({ seed: 91 }));
  const today = plan.days[3]!.date;

  it('mesure le respect du programme et les moyennes réelles', () => {
    const copy: WeekPlan = structuredClone(plan);
    const entries: { date: string; nutrition: (typeof plan.days)[0]['nutrition'] }[] = [];
    for (const day of copy.days.slice(0, 3)) {
      day.meals.forEach((meal, index) => {
        meal.status = day.index === 2 && index === 2 ? 'skipped' : 'eaten';
        if (meal.status === 'eaten') entries.push({ date: day.date, nutrition: meal.nutrition });
      });
    }
    const review = reviewWeek({ plan: copy, entries, today, plannedCost: 80, actualCost: 76.5 });
    // Les trois repas d'aujourd'hui, encore prévus, ne comptent pas comme des oublis.
    expect(review.mealsDue).toBe(9);
    expect(review.eaten).toBe(8);
    expect(review.skipped).toBe(1);
    expect(review.undeclared).toBe(0);
    expect(review.adherencePct).toBe(89);
    expect(review.daysLogged).toBe(3);
    expect(review.daysOnTarget).toBe(2);
    expect(review.avgKcal).toBeLessThan(2300);
    expect(review.targetKcal).toBe(2300);
    expect(review.actualCost).toBe(76.5);
  });

  it('compte comme oubli un repas d’un jour passé resté sans déclaration', () => {
    const copy: WeekPlan = structuredClone(plan);
    for (const day of copy.days.slice(0, 3)) day.meals.forEach((meal) => (meal.status = 'eaten'));
    copy.days[1]!.meals[0]!.status = 'planned';
    copy.days[3]!.meals[0]!.status = 'eaten';
    const review = reviewWeek({ plan: copy, entries: [], today });
    expect(review.mealsDue).toBe(10);
    expect(review.eaten).toBe(9);
    expect(review.undeclared).toBe(1);
    expect(review.adherencePct).toBe(90);
  });

  it('compare la moyenne réelle à la cible des jours comptés (jours d’entraînement compris)', () => {
    const cycled = generateWeek(makeInput({ seed: 91, training: { days: [true, false, true, false, true, false, false], bonusKcal: 200 } }));
    const entries = cycled.days.slice(0, 2).flatMap((day) => day.meals.map((meal) => ({ date: day.date, nutrition: meal.nutrition })));
    for (const day of cycled.days.slice(0, 2)) day.meals.forEach((meal) => (meal.status = 'eaten'));
    const review = reviewWeek({ plan: cycled, entries, today: cycled.days[2]!.date });
    expect(review.targetKcal).toBe(Math.round((dayTargetKcal(cycled, cycled.days[0]!) + dayTargetKcal(cycled, cycled.days[1]!)) / 2));
    expect(review.daysOnTarget).toBe(2);
  });

  it('estime la date d’arrivée à l’objectif seulement quand la tendance le permet', () => {
    const base = { trendKg: 110, remainingKg: 20 };
    expect(estimateGoalDate({ ...base, weeklyRateKg: -0.8 }, '2026-10-12')).toEqual({ weeks: 25, date: '2027-04-05' });
    expect(estimateGoalDate({ ...base, weeklyRateKg: null }, '2026-10-12')).toBeNull();
    expect(estimateGoalDate({ ...base, weeklyRateKg: 0.2 }, '2026-10-12')).toBeNull();
    expect(estimateGoalDate({ ...base, weeklyRateKg: -0.05 }, '2026-10-12')).toBeNull();
    expect(estimateGoalDate({ trendKg: 90, remainingKg: 0, weeklyRateKg: -0.8 }, '2026-10-12')).toBeNull();
  });
});
