import { describe, expect, it } from 'vitest';
import {
  ChainProductResolver,
  DEMO_INVENTORY,
  DEMO_MEALS,
  DEMO_PREFS,
  DEMO_TARGET,
  SEED_FOODS,
  SEED_TEMPLATES,
  type PackageOption,
  type ProductResolver,
  type ScannedProduct,
  addExtra,
  addScan,
  addToInventory,
  applyStock,
  buildShoppingList,
  computeHabits,
  consumeFromInventory,
  createSession,
  defaultStructure,
  finishSession,
  generateWeek,
  gotUnits,
  habitSuggestions,
  indexFoods,
  inferFood,
  isValidEan,
  isVariableWeightEan,
  itemStatus,
  matchScannedProduct,
  optimizePackages,
  parseOpenFoodFactsProduct,
  parseQuantity,
  plannedUnits,
  priceFreshness,
  pricePerKg,
  remainingGrams,
  scannedPackGrams,
  sessionTotals,
  setManualDone,
  STORAGE_ZONES,
  stockLabel,
  stockPacks,
  stockStep,
  stockToReset,
  storageZone,
  updateScan,
  weeklyNeeds,
} from '../src/index.js';

const foods = indexFoods(SEED_FOODS);
const pack = (label: string, grams: number, price: number, variableWeight = false): PackageOption => ({
  label,
  grams,
  price,
  variableWeight,
  source: 'user',
});

const plan = generateWeek({
  weekStart: '2026-10-12',
  seed: 3,
  foods: SEED_FOODS,
  templates: SEED_TEMPLATES,
  target: DEMO_TARGET,
  structure: defaultStructure(DEMO_MEALS),
  prefs: DEMO_PREFS,
  away: ['none', 'none', 'none', 'none', 'none', 'none', 'none'],
  inventory: {},
  previousSignatures: [],
});

describe('prix et conditionnements', () => {
  it('poulet : 1 480 g avec des barquettes de 500 g → 3 barquettes', () => {
    const result = optimizePackages(1480, [pack('Barquette 500 g', 500, 6.49)]);
    expect(result.choices).toEqual([expect.objectContaining({ grams: 500, count: 3 })]);
    expect(result.boughtG).toBe(1500);
    expect(result.cost).toBe(19.47);
  });

  it('riz : 820 g avec un paquet de 1 kg → 1 paquet', () => {
    const result = optimizePackages(820, [pack('Paquet 1 kg', 1000, 2.49)]);
    expect(result.choices[0]).toMatchObject({ count: 1, grams: 1000 });
    expect(result.boughtG - 820).toBe(180);
  });

  it('œufs : 14 œufs → 1 boîte de 12 + 1 boîte de 6 (plus économique que 2 × 12)', () => {
    const egg = 55;
    const result = optimizePackages(14 * egg, [pack('Boîte de 6', 6 * egg, 1.99), pack('Boîte de 12', 12 * egg, 3.49)]);
    expect(result.choices).toEqual([
      expect.objectContaining({ label: 'Boîte de 12', count: 1 }),
      expect.objectContaining({ label: 'Boîte de 6', count: 1 }),
    ]);
    expect(result.cost).toBe(5.48);
  });

  it('choisit le gros format quand il coûte moins cher au total', () => {
    const result = optimizePackages(900, [pack('500 g', 500, 6.49), pack('1 kg', 1000, 11.9)]);
    expect(result.choices).toEqual([expect.objectContaining({ label: '1 kg', count: 1 })]);
  });

  it('stratégie anti-gaspillage : minimise le reste', () => {
    const options = [pack('400 g', 400, 5.29), pack('1 kg', 1000, 9.0)];
    expect(optimizePackages(700, options, 'cheapest').boughtG).toBe(1000);
    expect(optimizePackages(700, options, 'least-waste').boughtG).toBe(800);
  });

  it('stratégie prix au kilo : accepte le gros format seulement pour le non périssable', () => {
    const options = [pack('500 g', 500, 1.55), pack('1 kg', 1000, 2.49)];
    expect(optimizePackages(400, options, 'best-unit-price', false).boughtG).toBe(1000);
    expect(optimizePackages(400, options, 'best-unit-price', true).boughtG).toBe(500);
  });

  it('produits au poids : paie exactement la quantité prise', () => {
    const result = optimizePackages(360, [pack('Au kilo', 1000, 1.99, true)]);
    expect(result.boughtG).toBe(360);
    expect(result.cost).toBe(0.72);
  });

  it('calcule le prix au kilo et la fraîcheur des prix mémorisés', () => {
    expect(pricePerKg(6.49, 500)).toBe(12.98);
    expect(priceFreshness('2026-10-01', '2026-10-12')).toBe('fresh');
    expect(priceFreshness('2026-08-20', '2026-10-12')).toBe('aging');
    expect(priceFreshness('2026-05-01', '2026-10-12')).toBe('stale');
    expect(priceFreshness(undefined, '2026-10-12')).toBe('unknown');
  });
});

describe('liste de courses', () => {
  it('additionne les besoins de la semaine par aliment', () => {
    const needs = weeklyNeeds(plan);
    const manual = plan.days.flatMap((d) => d.meals.flatMap((m) => m.items)).filter((i) => i.foodId === 'skyr').reduce((s, i) => s + i.grams, 0);
    expect(needs.get('skyr')).toBe(manual);
  });

  it('soustrait les stocks et calcule quantités, restes et coûts', () => {
    const list = buildShoppingList({ plan, foods, inventory: DEMO_INVENTORY, packages: {}, strategy: 'cheapest' });
    for (const item of list.items) {
      const stock = DEMO_INVENTORY[item.foodId] ?? 0;
      expect(item.fromStockG).toBe(Math.min(stock, item.neededG));
      expect(item.toBuyG).toBe(item.neededG - item.fromStockG);
      expect(item.boughtG).toBeGreaterThanOrEqual(item.toBuyG);
      expect(item.leftoverG).toBe(stock + item.boughtG - item.neededG);
      if (item.toBuyG === 0) expect(item.cost).toBe(0);
    }
    const sum = Math.round(list.items.reduce((s, i) => s + i.cost, 0) * 100) / 100;
    expect(list.totals.cost).toBe(sum);
    expect(list.totals.perDay).toBeCloseTo(sum / 7, 1);
    expect(list.totals.perMeal).toBeCloseTo(sum / 21, 1);
    // En cours de semaine, seuls les jours restants comptent.
    const late = buildShoppingList({ plan, foods, inventory: {}, packages: {}, strategy: 'cheapest', fromDate: plan.days[4]!.date });
    expect(late.totals.perDay).toBeCloseTo(late.totals.cost / 3, 1);
    expect(late.totals.cost).toBeLessThan(list.totals.cost + 60);
  });

  it('coûte moins cher avec des stocks que sans', () => {
    const without = buildShoppingList({ plan, foods, inventory: {}, packages: {}, strategy: 'cheapest' });
    const withStock = buildShoppingList({ plan, foods, inventory: DEMO_INVENTORY, packages: {}, strategy: 'cheapest' });
    expect(withStock.totals.cost).toBeLessThanOrEqual(without.totals.cost);
  });

  it('utilise les prix relevés par l’utilisateur quand ils existent', () => {
    const list = buildShoppingList({
      plan,
      foods,
      inventory: {},
      packages: { skyr: [{ label: 'Skyr Leclerc 4 × 140 g', grams: 560, price: 2.5, source: 'user', priceDate: '2026-10-05' }] },
      strategy: 'cheapest',
    });
    const skyr = list.items.find((i) => i.foodId === 'skyr')!;
    expect(skyr.priceSource).toBe('user');
    expect(skyr.cost).toBe(skyr.packages[0]!.count * 2.5);
    expect(list.totals.estimatedShare).toBeLessThan(1);
  });

  it('regroupe par rayon dans l’ordre du magasin', () => {
    const order = ['surgeles', 'fruits', 'viandes-poissons', 'produits-laitiers', 'feculents', 'epicerie', 'boissons', 'autres'] as const;
    const list = buildShoppingList({ plan, foods, inventory: {}, packages: {}, strategy: 'cheapest', aisleOrder: [...order] });
    const ranks = list.items.map((i) => order.indexOf(i.aisle));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('inventaire', () => {
  it('retire les quantités mangées sans passer sous zéro', () => {
    const { inventory, changes } = consumeFromInventory({ riz: 650, poulet: 100 }, [
      { foodId: 'riz', grams: 100 },
      { foodId: 'poulet', grams: 250 },
      { foodId: 'beurre', grams: 10 },
    ]);
    expect(inventory).toEqual({ riz: 550, poulet: 0, beurre: 0 });
    expect(changes.find((c) => c.foodId === 'poulet')!.delta).toBe(-100);
  });

  it('ajoute les achats après les courses', () => {
    const { inventory } = addToInventory({ riz: 550 }, [
      { foodId: 'riz', grams: 1000 },
      { foodId: 'skyr', grams: 560 },
    ]);
    expect(inventory).toEqual({ riz: 1550, skyr: 560 });
  });

  it('range chaque aliment dans une zone : frais, surgelés ou placard', () => {
    const zone = (id: string) => storageZone(foods.get(id)!);
    // Ce qui vit au frigo ou se périme vite, même si son prix ne pousse pas à l'acheter en gros.
    for (const id of ['poulet', 'skyr', 'oeufs', 'beurre', 'parmesan', 'banane', 'pomme', 'pain-complet', 'creme-legere']) expect(zone(id), id).toBe('frais');
    for (const id of ['riz', 'pates', 'thon', 'lait', 'compote', 'huile-olive', 'whey', 'epices-cajun', 'pommes-de-terre']) expect(zone(id), id).toBe('placard');
    for (const id of ['poisson-blanc', 'fruits-rouges']) expect(zone(id), id).toBe('surgele');
    // Chaque aliment du catalogue a une zone connue.
    for (const food of SEED_FOODS) expect(STORAGE_ZONES.map((z) => z.key)).toContain(storageZone(food));
  });

  it('remet à zéro une zone sans toucher aux autres, et rend de quoi annuler', () => {
    const entries = [
      { foodId: 'poulet', grams: 500 },
      { foodId: 'skyr', grams: 560 },
      { foodId: 'riz', grams: 900 },
      { foodId: 'fruits-rouges', grams: 450 },
      { foodId: 'aliment-disparu', grams: 80 },
    ];
    const fresh = stockToReset(entries, foods, 'frais');
    expect(fresh).toEqual([
      { foodId: 'poulet', grams: 500 },
      { foodId: 'skyr', grams: 560 },
    ]);
    const emptied = applyStock(entries, Object.fromEntries(fresh.map((e) => [e.foodId, 0])));
    expect(emptied.map((e) => e.foodId).sort()).toEqual(['aliment-disparu', 'fruits-rouges', 'riz']);
    // Annuler : on refixe les quantités retirées.
    expect(applyStock(emptied, Object.fromEntries(fresh.map((e) => [e.foodId, e.grams])))).toHaveLength(5);
    // Tout vider emporte aussi un aliment sorti du catalogue.
    expect(stockToReset(entries, foods)).toHaveLength(5);
    expect(stockToReset(entries, foods, 'placard').map((e) => e.foodId)).toEqual(['riz']);
  });

  it('affiche le stock dans l’unité la plus parlante et propose les formats habituels', () => {
    const eggs = foods.get('oeufs')!;
    expect(stockLabel(eggs, eggs.piece!.grams * 6)).toBe('6 œufs');
    expect(stockLabel(foods.get('riz')!, 1200)).toBe('1,2 kg');
    expect(stockStep(eggs)).toBe(eggs.piece!.grams);
    expect(stockStep(foods.get('riz')!)).toBe(50);
    expect(stockStep(foods.get('huile-olive')!)).toBe(10);
    // Le format relevé par l'utilisateur passe devant celui du catalogue, sans doublon.
    const packs = stockPacks(foods.get('riz')!, [{ grams: 1000 }, { grams: 500 }]);
    expect(packs.map((p) => p.grams)).toEqual([1000, 500]);
    expect(stockPacks(eggs)[0]!.label).toMatch(/œufs$/);
    // Vendu au poids mais compté à la pièce : le format devient un nombre entier de pièces.
    const banana = foods.get('banane')!;
    for (const pack of stockPacks(banana)) expect(pack.grams % banana.piece!.grams).toBe(0);
    expect(stockPacks(banana)[0]!.label).toMatch(/^\d+ bananes$/);
  });

  it('déduit le poids ajouté par un produit scanné', () => {
    const rice = foods.get('riz')!;
    expect(scannedPackGrams({ grams: 1000 }, rice)).toBe(1000);
    // Poids inconnu : le format habituel de l'aliment.
    expect(scannedPackGrams({}, rice)).toBe(rice.packages[0]!.grams);
    expect(scannedPackGrams(null, rice)).toBe(rice.packages[0]!.grams);
    // Rayon coupe : le poids est sur l'étiquette, pas dans le code.
    expect(scannedPackGrams({ grams: 350, variableWeight: true }, foods.get('poulet')!)).toBeNull();
  });
});

describe('mode courses : session et scans', () => {
  const list = buildShoppingList({
    plan,
    foods,
    inventory: {},
    packages: { poulet: [{ label: 'Barquette 500 g', grams: 500, price: 6.49, source: 'user', ean: '3250390000013' }] },
    strategy: 'cheapest',
  });
  const store = { id: 'store-1', name: 'E.Leclerc' };
  const base = createSession('s1', 'l1', list, store, '2026-10-11T10:00:00Z');
  const chicken = base.items.find((i) => i.foodId === 'poulet')!;
  const product: ScannedProduct = { ean: '3250390000013', name: 'Filets de poulet', brand: 'Marque Repère', grams: 500, price: 6.49, foodId: 'poulet', source: 'user' };

  it('crée une session avec les articles à acheter et le budget prévu', () => {
    expect(base.items).toHaveLength(list.items.filter((i) => i.toBuyG > 0).length);
    expect(base.plannedTotal).toBe(list.totals.cost);
    expect(sessionTotals(base)).toMatchObject({ itemsDone: 0, actualTotal: 0 });
  });

  it('incrémente la quantité à chaque scan et termine l’article une fois le besoin couvert', () => {
    const units = plannedUnits(chicken);
    let session = base;
    for (let n = 1; n <= units; n++) {
      session = addScan(session, chicken.id, { lineId: `l${n}`, product, at: `2026-10-11T10:0${n}:00Z` });
      const item = session.items.find((i) => i.id === chicken.id)!;
      expect(gotUnits(item)).toBe(n);
      expect(itemStatus(item)).toBe(n < units ? 'partial' : 'done');
      expect(remainingGrams(item)).toBe(Math.max(0, chicken.neededG - n * 500));
    }
    const item = session.items.find((i) => i.id === chicken.id)!;
    expect(item.scans).toHaveLength(1);
    expect(sessionTotals(session).actualTotal).toBe(Math.round(units * 6.49 * 100) / 100);
    expect(sessionTotals(session).itemsDone).toBe(1);
  });

  it('gère un poids réel et un prix saisis après le scan', () => {
    const variable: ScannedProduct = { ean: '2012345000000', name: 'Poulet à la coupe', variableWeight: true, foodId: 'poulet', source: 'manual' };
    let session = addScan(base, chicken.id, { lineId: 'v1', product: variable, grams: 612, price: 7.34, at: '2026-10-11T10:05:00Z' });
    let item = session.items.find((i) => i.id === chicken.id)!;
    expect(item.scans[0]).toMatchObject({ grams: 612, price: 7.34, priceSource: 'user' });
    session = updateScan(session, 'v1', { grams: 640, price: 7.68 }, '2026-10-11T10:06:00Z');
    item = session.items.find((i) => i.id === chicken.id)!;
    expect(item.scans[0]!.grams).toBe(640);
    expect(sessionTotals(session).actualTotal).toBe(7.68);
    session = updateScan(session, 'v1', { qty: 0 }, '2026-10-11T10:07:00Z');
    expect(session.items.find((i) => i.id === chicken.id)!.scans).toHaveLength(0);
  });

  it('suit les achats imprévus et clôture avec résumé, stocks et prix relevés', () => {
    let session = base;
    for (const item of base.items) {
      if (item.foodId === 'skyr') continue; // un produit manquant en rayon
      if (item.foodId === 'poulet') {
        session = addScan(session, item.id, { lineId: 'p', product, qty: plannedUnits(item), at: '2026-10-11T10:10:00Z' });
      } else {
        session = setManualDone(session, item.id, true, '2026-10-11T10:11:00Z');
      }
    }
    const chocolate: ScannedProduct = { ean: '3017620422003', name: 'Pâte à tartiner', grams: 400, price: 3.2, source: 'off' };
    session = addExtra(session, { lineId: 'x', product: chocolate, at: '2026-10-11T10:12:00Z' }, 'cart');

    const { session: finished, purchase } = finishSession(session, '2026-10-11T10:30:00Z');
    expect(finished.status).toBe('finished');
    expect(purchase.itemsPlanned).toBe(base.items.length);
    expect(purchase.itemsBought).toBe(base.items.length - 1);
    expect(purchase.missing.map((m) => m.foodId)).toEqual(['skyr']);
    expect(purchase.items.some((i) => i.unplanned && i.name === 'Pâte à tartiner')).toBe(true);
    // L'économie se mesure à périmètre égal : le skyr manquant et l'achat imprévu n'y entrent pas.
    const skyrCost = base.items.find((i) => i.foodId === 'skyr')!.plannedCost;
    expect(purchase.plannedBought).toBe(Math.round((purchase.plannedTotal - skyrCost) * 100) / 100);
    expect(purchase.actualOnList).toBe(Math.round((purchase.actualTotal - 3.2) * 100) / 100);
    expect(purchase.saving).toBe(Math.round((purchase.plannedBought - purchase.actualOnList) * 100) / 100);
    const chickenAdd = purchase.inventoryAdds.find((a) => a.foodId === 'poulet')!;
    expect(chickenAdd.grams).toBe(plannedUnits(chicken) * 500);
    expect(purchase.inventoryAdds.some((a) => a.foodId === 'skyr')).toBe(false);
    expect(purchase.priceObservations).toContainEqual(expect.objectContaining({ ean: '3250390000013', price: 6.49, grams: 500 }));
  });
});

describe('correspondance intelligente des produits scannés', () => {
  const list = buildShoppingList({ plan, foods, inventory: {}, packages: {}, strategy: 'cheapest' });
  const session = createSession('s2', 'l2', list, { id: 'store-1', name: 'E.Leclerc' }, '2026-10-11T10:00:00Z');
  const prefs = { excludedFoods: [], bannedBrands: ['MarqueInterdite'] };
  const wanted = (foodId: string) => session.items.find((i) => i.foodId === foodId);

  it('reconnaît une autre marque du même aliment grâce aux catégories et au nom', () => {
    const rice: ScannedProduct = {
      ean: '3560070000000',
      name: 'Riz basmati',
      brand: 'Autre Marque',
      grams: 1000,
      per100: { kcal: 352, protein: 8 },
      categories: ['en:rices', 'en:basmati-rices'],
      source: 'off',
    };
    expect(inferFood(rice, SEED_FOODS)!.food.id).toBe('riz');
    const match = matchScannedProduct(rice, session, foods, prefs);
    if (wanted('riz')) {
      expect(match.kind).toBe('exact');
      expect(match.itemId).toBe(wanted('riz')!.id);
    } else {
      expect(match.kind).toBe('unplanned');
    }
  });

  it('distingue pâtes complètes et pâtes classiques', () => {
    const whole: ScannedProduct = { name: 'Penne complètes bio', categories: ['en:whole-wheat-pastas'], source: 'off' };
    expect(inferFood(whole, SEED_FOODS)!.food.id).toBe('pates-completes');
    const plain: ScannedProduct = { name: 'Fusilli', categories: ['en:pastas'], source: 'off' };
    expect(inferFood(plain, SEED_FOODS)!.food.id).toBe('pates');
  });

  it('propose un remplacement dans la même famille, avec l’écart nutritionnel', () => {
    const planned = session.items.find((i) => ['poulet', 'dinde'].includes(i.foodId));
    expect(planned).toBeDefined();
    const other = planned!.foodId === 'poulet' ? 'dinde' : 'poulet';
    if (wanted(other)) return; // les deux sont prévus : pas de substitution à tester sur cette semaine
    const product: ScannedProduct = { name: other === 'dinde' ? 'Escalopes de dinde' : 'Filets de poulet', grams: 500, foodId: other, source: 'local' };
    const match = matchScannedProduct(product, session, foods, prefs);
    expect(match.kind).toBe('substitute');
    expect(match.itemId).toBe(planned!.id);
    expect(match.deltas).toBeDefined();
  });

  it('signale un produit non prévu cette semaine', () => {
    const match = matchScannedProduct({ name: 'Pâte à tartiner noisettes', source: 'off' }, session, foods, prefs);
    expect(match.kind).toBe('unplanned');
  });

  it('refuse une marque interdite ou un produit trop éloigné nutritionnellement', () => {
    const banned = matchScannedProduct({ name: 'Skyr nature', brand: 'MarqueInterdite', foodId: 'skyr', source: 'local' }, session, foods, prefs);
    expect(banned.kind).toBe('rejected');
    const sweet = matchScannedProduct(
      { name: 'Skyr saveur vanille sucré', per100: { kcal: 120, protein: 6 }, foodId: 'skyr', source: 'off' },
      session,
      foods,
      prefs,
    );
    expect(sweet.kind).toBe('rejected');
  });
});

describe('résolution des codes-barres', () => {
  const hit = (name: string, product: ScannedProduct | null): ProductResolver => ({ name, resolve: async () => product });
  const product: ScannedProduct = { ean: '3017620422003', name: 'Produit', source: 'user' };

  it('interroge les sources dans l’ordre et s’arrête à la première réponse', async () => {
    const chain = new ChainProductResolver([hit('local', null), hit('user', product), hit('off', { ...product, name: 'Autre' })]);
    const outcome = await chain.resolveWithTrace('3017620422003');
    expect(outcome.product).toBe(product);
    expect(outcome.attempts.map((a) => `${a.resolver}:${a.status}`)).toEqual(['local:miss', 'user:hit']);
  });

  it('continue de fonctionner quand un service externe échoue ou ne répond pas', async () => {
    const failing: ProductResolver = { name: 'magasin', resolve: async () => Promise.reject(new Error('503')) };
    const hanging: ProductResolver = { name: 'lent', resolve: () => new Promise(() => undefined) };
    const chain = new ChainProductResolver([failing, hanging, hit('local', product)], 20);
    const outcome = await chain.resolveWithTrace('3017620422003');
    expect(outcome.product).toBe(product);
    expect(outcome.attempts.map((a) => a.status)).toEqual(['error', 'timeout', 'hit']);
    expect(await new ChainProductResolver([failing], 20).resolve('3017620422003')).toBeNull();
  });

  it('valide les codes EAN-13, EAN-8 et UPC-A', () => {
    expect(isValidEan('3017620422003')).toBe(true);
    expect(isValidEan('3017620422004')).toBe(false);
    expect(isValidEan('96385074')).toBe(true);
    expect(isValidEan('036000291452')).toBe(true);
    expect(isValidEan('abc')).toBe(false);
    expect(isVariableWeightEan('2012345000000')).toBe(true);
    expect(isVariableWeightEan('3017620422003')).toBe(false);
  });

  it('interprète les quantités des emballages', () => {
    expect(parseQuantity('500 g')).toBe(500);
    expect(parseQuantity('1,5 kg')).toBe(1500);
    expect(parseQuantity('4 x 125 g')).toBe(500);
    expect(parseQuantity('75 cl')).toBe(750);
    expect(parseQuantity('1 L')).toBe(1000);
    expect(parseQuantity('')).toBeUndefined();
  });

  it('convertit une réponse Open Food Facts', () => {
    const parsed = parseOpenFoodFactsProduct(
      {
        status: 1,
        product: {
          product_name_fr: 'Skyr nature',
          brands: 'Siggi’s, Lactalis',
          quantity: '4 x 140 g',
          categories_tags: ['en:dairies', 'en:skyrs'],
          nutriments: { 'energy-kcal_100g': 63, proteins_100g: '10', fat_100g: 0.2 },
        },
      },
      '3033490000000',
    );
    expect(parsed).toMatchObject({ name: 'Skyr nature', brand: 'Siggi’s', grams: 560, source: 'off', per100: { kcal: 63, protein: 10, fat: 0.2 } });
    expect(inferFood(parsed!, SEED_FOODS)!.food.id).toBe('skyr');
    expect(parseOpenFoodFactsProduct({ status: 0 }, '1')).toBeNull();
  });
});

describe('habitudes d’achat', () => {
  it('propose le conditionnement habituel après plusieurs courses', () => {
    const list = buildShoppingList({ plan, foods, inventory: {}, packages: {}, strategy: 'cheapest' });
    const target = list.items.find((i) => i.toBuyG > 0 && !i.packages[0]!.variableWeight)!;
    const usual = Math.round((target.packages[0]!.grams * 1.5) / 10) * 10;
    const purchase = (sessionId: string) => ({
      sessionId,
      listId: 'l',
      storeId: 's',
      weekStart: '2026-10-05',
      date: '2026-10-04',
      items: [{ foodId: target.foodId, name: target.name, brand: 'Marque Repère', grams: usual, qty: 2, price: 7.2, substitution: false, unplanned: false, toStock: true }],
      plannedTotal: 0,
      actualTotal: 0,
      plannedBought: 0,
      actualOnList: 0,
      saving: 0,
      itemsPlanned: 1,
      itemsBought: 1,
      missing: [],
      inventoryAdds: [],
      priceObservations: [],
    });
    const habits = computeHabits([purchase('a'), purchase('b')]);
    expect(habits[0]).toMatchObject({ foodId: target.foodId, purchases: 2, usualBrand: 'Marque Repère', usualPackGrams: usual });
    const suggestions = habitSuggestions(list, habits, foods);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.message).toMatch(/Tu achètes généralement/);
    expect(habitSuggestions(list, computeHabits([purchase('a')]), foods)).toHaveLength(0);
  });
});
