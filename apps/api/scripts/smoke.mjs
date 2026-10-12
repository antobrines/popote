/**
 * Test de bout en bout de l'API contre une instance en cours d'exécution.
 *
 *   npm run dev:api                       (dans un autre terminal)
 *   npm run smoke -w @bouffe/api
 *
 * Crée un compte temporaire, déroule tous les parcours, puis supprime ce compte :
 * aucun compte existant n'est lu ni modifié.
 */
import { randomBytes } from 'node:crypto';

const base = process.env.API_URL ?? 'http://localhost:3000/api';
let token = '';
let cookie = '';
let failures = 0;
async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok && !path.includes('expect')) console.log('  ..', method, path.split('?')[0], res.status, typeof json === 'string' ? json.slice(0, 200) : JSON.stringify(json).slice(0, 300));
  return { status: res.status, json };
}
const ok = (label, cond, extra = '') => {
  if (!cond) failures++;
  console.log(cond ? 'OK  ' : 'FAIL', label, extra);
};

const email = `smoke-${Date.now()}@bouffe.test`;
const password = randomBytes(12).toString('base64url');

const health = await call('GET', '/health');
ok('health', health.status === 200 && health.json.status === 'ok' && typeof health.json.signup === 'boolean', `inscriptions ${health.json.signup ? 'ouvertes' : 'fermees'}`);
if (health.json.signup === false) {
  console.log('Les inscriptions sont fermees sur cette installation : ce test a besoin de creer un compte temporaire (ALLOW_SIGNUP=true).');
  process.exit(1);
}
ok('state sans token = 401', (await call('GET', '/state?expect')).status === 401);
const registered = await call('POST', '/auth/register', { email, password, displayName: 'Smoke' });
token = registered.json.accessToken;
ok('inscription', registered.status === 201 && !!token && !!cookie, `hashExpose=${'passwordHash' in (registered.json.user ?? {})}`);
ok('login mauvais mdp = 401', (await call('POST', '/auth/login?expect', { email, password: 'mauvais-mot-de-passe' })).status === 401);
const login = await call('POST', '/auth/login', { email, password });
token = login.json.accessToken;
ok('login', login.status === 200 && !!token);
const refreshed = await call('POST', '/auth/refresh');
token = refreshed.json.accessToken;
ok('refresh (rotation)', refreshed.status === 200 && !!token);

// Tout le parcours est protégé : une erreur inattendue ne doit pas laisser le compte de test en base.
try {
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = new Date();
const today = iso(now);
const shift = (days) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
const nextMonday = shift(((8 - now.getDay()) % 7) || 7);
const yesterday = shift(-1);

let st = (
  await call('POST', '/me/onboarding', {
    today,
    displayName: 'Smoke',
    profile: { sex: 'male', age: 27, heightCm: 184, weightKg: 116, goalWeightKg: 90, activity: 'light' },
    target: { kcal: 2300, protein: 180 },
    preferences: { likedFoods: ['poulet', 'riz', 'pates'], excludedFoods: [], excludedTags: ['legume'], meals: ['dejeuner', 'collation', 'diner'], level: 'normal' },
    store: { name: 'E.Leclerc' },
    consentHealthData: true,
  })
).json;
ok(
  'onboarding',
  !!st.user?.onboardedAt && st.goal?.kcal === 2300 && st.stores?.[0]?.chain === 'leclerc' && st.user.preferences.equipment.length > 0,
  `equipement=${st.user?.preferences.equipment.length} magasin=${st.stores?.[0]?.name}`,
);
for (const [food, grams] of Object.entries({ riz: 650, pates: 400, poulet: 500, oeufs: 330, compote: 900 })) {
  await call('PUT', `/inventory/${food}`, { today, grams });
}
st = (await call('POST', '/meal-plans/generate', { today })).json;
ok('generation semaine en cours', st.plan?.days?.length === 7, st.plan?.days?.map((d) => d.nutrition.kcal).join(' '));
st = (await call('GET', `/state?today=${today}&catalog=1`)).json;
ok('state', !!st.plan && st.foods?.length > 50, `aliments=${st.foods?.length} modeles=${st.templates?.length} listes=${st.shoppingLists?.length} stocks=${st.inventory?.length} pesees=${st.weights?.length}`);
// Style « simple » par defaut : des assiettes sans recette, et la semaine en tableau.
const shared = await import('@bouffe/core');
const homeMeals = st.plan.days.flatMap((d) => d.meals).filter((m) => m.context === 'home');
const TAB = String.fromCharCode(9);
const tableau = shared.planTableText(st.plan, shared.indexFoods(st.foods)).split(String.fromCharCode(10));
ok(
  'style simple par defaut',
  st.user.preferences.style === 'simple' && st.plan.style === 'simple' && homeMeals.length === 21 && homeMeals.every((m) => m.templateId.startsWith('simple-')) && tableau[0] === ['Jour', 'Midi', 'Collation', 'Soir'].join(TAB) && tableau.length === 8,
  tableau[1].split(TAB).join(' | ').slice(0, 170),
);
ok('yaourt au catalogue (valeurs Ciqual)', st.foods.find((f) => f.id === 'yaourt')?.ciqual?.code === '19593' && st.foods.find((f) => f.id === 'riz')?.rawLabel === 'cru');
ok('profil', st.user.profile.startWeightKg === 116 && st.weightSummary.currentKg === 116, `reste=${st.weightSummary.remainingKg} kg`);
console.log('   suggestion:', st.calorieSuggestion.kind, '-', st.calorieSuggestion.reason.slice(0, 80));
console.log('   integrations:', st.integrations.retail.map((r) => `${r.id}:${r.available}`).join(' '), '|', st.integrations.health.map((r) => `${r.id}:${r.available}`).join(' '));

st = (await call('POST', '/meal-plans/generate', { today, weekStart: nextMonday, away: ['none', 'lunch', 'none', 'none', 'full', 'none', 'none'] })).json;
const plan = st.nextPlan;
ok('generation semaine suivante', plan?.days?.length === 7, plan?.days?.map((d) => `${d.nutrition.kcal}/${d.nutrition.protein}`).join(' '));
const list = st.shoppingLists.find((l) => l.weekStart === nextMonday);
ok('liste de courses auto', list?.items?.length > 10, `articles=${list?.items.length} total=${list?.totals.cost} jour=${list?.totals.perDay} repas=${list?.totals.perMeal}`);

const meal = plan.days[0].meals[0];
const alts = (await call('GET', `/meal-plans/${plan.id}/meals/${meal.id}/alternatives`)).json;
ok('alternatives', alts.length === 3, alts.map((a) => a.name).join(' | '));
st = (await call('POST', `/meal-plans/${plan.id}/meals/${meal.id}/replace`, { today })).json;
const d0 = st.nextPlan.days[0];
ok('remplacer un repas', d0.meals[0].signature !== meal.signature && Math.abs(d0.nutrition.kcal - 2300) <= 50, `${meal.name} => ${d0.meals[0].name} (${d0.nutrition.kcal} kcal)`);
let m2, slot, falts = [];
for (const candidate of st.nextPlan.days[0].meals) {
  for (const item of candidate.items.filter((i) => i.scaling !== 'fixed')) {
    const options = (await call('GET', `/meal-plans/${plan.id}/meals/${candidate.id}/items/${item.slotKey}/alternatives`)).json;
    if (options.length > falts.length) [m2, slot, falts] = [candidate, item.slotKey, options];
  }
}
ok('alternatives aliment', falts.length > 0, `${m2.name} [${slot}] : ` + falts.map((f) => `${f.name} ${f.grams}g`).join(' | '));
st = (await call('POST', `/meal-plans/${plan.id}/meals/${m2.id}/items/${slot}/replace`, { today, foodId: falts[0].foodId })).json;
const swapped = st.nextPlan.days[0].meals.find((m) => m.id === m2.id);
ok('remplacer un aliment', swapped.items.some((i) => i.foodId === falts[0].foodId) && Math.abs(st.nextPlan.days[0].nutrition.kcal - 2300) <= 50, `${swapped.name} (${st.nextPlan.days[0].nutrition.kcal} kcal)`);
const recipe = (await call('GET', `/meal-plans/${plan.id}/meals/${st.nextPlan.days[2].meals[2].id}/recipe`)).json;
ok('recette', recipe.steps?.length > 2, `${recipe.title} : ${recipe.prepMin}+${recipe.cookMin} min`);
const prep = (await call('GET', `/meal-plans/${plan.id}/meal-prep?from=0&days=3`)).json;
ok('meal prep', prep.totals?.length > 0, prep.totals.slice(0, 3).map((t) => t.label).join(' | '));
st = (await call('PATCH', `/meal-plans/${plan.id}/days/3`, { today, away: 'full' })).json;
ok('jour hors domicile apres coup', st.nextPlan.days[3].away === 'full' && st.nextPlan.days[3].meals.every((m) => m.context === 'away'), st.nextPlan.days[3].meals.map((m) => m.name).join(' | '));
st = (await call('POST', `/meal-plans/${plan.id}/meals/${st.nextPlan.days[2].meals[2].id}/feedback`, { rating: 5, favorite: true })).json;
ok('note + favori', st.user.preferences.mealFeedback.some((f) => f.rating === 5 && f.favorite));

const cur = st.plan;
const dayIdx = cur.days.findIndex((d) => d.date === today);
const lunch = cur.days[dayIdx].meals[0];
const inv = (s) => Object.fromEntries(s.inventory.map((i) => [i.foodId, i.grams]));
const invBefore = inv(st);
st = (await call('POST', `/meal-plans/${cur.id}/meals/${lunch.id}/log`, { today, status: 'eaten' })).json;
const eaten = st.entries.filter((e) => e.date === today);
const kcal = eaten.reduce((s, e) => s + e.nutrition.kcal, 0);
ok('declarer mange', st.plan.days[dayIdx].meals[0].status === 'eaten' && eaten.length === lunch.items.length, `reel du jour=${Math.round(kcal)} kcal (repas prevu ${lunch.nutrition.kcal})`);
const stocked = lunch.items.find((i) => invBefore[i.foodId] > 0);
ok('stocks decrementes', !stocked || (inv(st)[stocked.foodId] ?? 0) === Math.max(0, invBefore[stocked.foodId] - stocked.grams), stocked ? `${stocked.foodId}: ${invBefore[stocked.foodId]} => ${inv(st)[stocked.foodId] ?? 0}` : '(aucun ingredient en stock)');
st = (await call('DELETE', `/meal-plans/${cur.id}/meals/${lunch.id}/log?today=${today}`)).json;
ok('annuler la declaration', st.plan.days[dayIdx].meals[0].status === 'planned' && st.entries.filter((e) => e.date === today).length === 0 && (!stocked || inv(st)[stocked.foodId] === invBefore[stocked.foodId]));
st = (await call('POST', `/meal-plans/${cur.id}/meals/${lunch.id}/log`, { today, status: 'partial', rebalance: true, items: [{ foodId: lunch.items[0].foodId, grams: Math.round(lunch.items[0].grams / 2) }] })).json;
const dd = st.plan.days[dayIdx];
const real = st.entries.filter((e) => e.date === today).reduce((s, e) => s + e.nutrition.kcal, 0);
const rest = dd.meals.filter((m) => m.status === 'planned').reduce((s, m) => s + m.nutrition.kcal, 0);
ok('partiel + reequilibrage', dd.meals[0].status === 'partial', `reel ${Math.round(real)} + reste prevu ${rest} = ${Math.round(real + rest)} kcal`);
await call('DELETE', `/meal-plans/${cur.id}/meals/${lunch.id}/log?today=${today}`);

st = (await call('PUT', `/weights/${yesterday}`, { today, kg: 116.4 })).json;
ok('pesee', st.weights.some((w) => w.date === yesterday && w.kg === 116.4));
await call('DELETE', `/weights/${yesterday}?today=${today}`);
st = (await call('PUT', `/activities/${today}`, { today, steps: 8200, activeKcal: 410, workouts: [{ kind: 'Marche', minutes: 45 }] })).json;
ok('activite manuelle', st.activities.some((a) => a.steps === 8200 && a.workouts.length === 1));
st = (await call('PUT', '/inventory/semoule', { today, grams: 500 })).json;
ok('stock modifie', st.inventory.some((i) => i.foodId === 'semoule' && i.grams === 500));
await call('PUT', '/inventory/semoule', { today, grams: 0 });

// Stock groupe : plusieurs aliments en un envoi (serie de scans), puis remise a zero d'une partie.
const stockBefore = st.inventory.length;
st = (await call('PUT', '/inventory', { today, stock: { semoule: 300, miel: 250, 'fruits-rouges': 450 } })).json;
ok('stock groupe', inv(st).semoule === 300 && inv(st).miel === 250 && inv(st)['fruits-rouges'] === 450, `${stockBefore} > ${st.inventory.length} aliments en stock`);
st = (await call('PUT', '/inventory', { today, stock: { miel: 0, 'fruits-rouges': 0, 'aliment-disparu': 0 } })).json;
ok('remise a zero groupee', !inv(st).miel && !inv(st)['fruits-rouges'] && inv(st).semoule === 300);
ok('stock : aliment inconnu = 404', (await call('PUT', '/inventory#expect', { today, stock: { 'aliment-inconnu': 100 } })).status === 404);
ok('stock : quantite invalide = 400', (await call('PUT', '/inventory#expect', { today, stock: { riz: -5 } })).status === 400);
st = (await call('PUT', '/inventory', { today, stock: { semoule: 0 } })).json;

// Scan a la maison : le code-barres est rattache a un aliment et reconnu ensuite.
const learned = await call('PUT', '/barcodes/3760205070129', { name: 'Riz long du test', brand: 'Test', grams: 1000, foodId: 'riz' });
const recalled = (await call('GET', '/barcodes/3760205070129')).json;
ok(
  'code-barres rattache a un aliment (scan a la maison)',
  learned.status === 200 && recalled.product?.foodId === 'riz' && recalled.product?.grams === 1000,
  `${recalled.product?.name} via ${recalled.attempts.map((a) => `${a.resolver}:${a.status}`).join(' > ')}`,
);
ok('rattachement : aliment inconnu = 404', (await call('PUT', '/barcodes/3760205070129#expect', { name: 'X', grams: 100, foodId: 'aliment-inconnu' })).status === 404);

st = (await call('PUT', `/retail-products?today=${today}`, { foodKey: 'skyr', label: 'Skyr nature 4 x 140 g', grams: 560, price: 2.79 })).json;
const skyr = st.shoppingLists.flatMap((l) => l.items).find((i) => i.foodId === 'skyr' && i.toBuyG > 0);
ok('prix releve reutilise dans la liste', !skyr || skyr.priceSource === 'user', skyr ? `${skyr.packages.map((p) => `${p.count}x${p.label}`).join('+')} = ${skyr.cost}` : '(pas de skyr a acheter)');
const rp = st.retailProducts.find((r) => r.foodKey === 'skyr');
if (rp) await call('DELETE', `/retail-products/${rp.id}?today=${today}`);
const bc = (await call('GET', '/barcodes/3017620422003')).json;
ok('code-barres (chaine de resolveurs)', Array.isArray(bc.attempts), `${bc.product?.name ?? 'introuvable'} via ${bc.attempts.map((a) => `${a.resolver}:${a.status}`).join(' > ')}`);
ok('code-barres invalide = 400', (await call('GET', '/barcodes/123?expect')).status === 400);
ok('validation DTO = 400', (await call('PUT', `/weights/${yesterday}?expect`, { kg: 5 })).status === 400);
const before = st.user.preferences;
await call('PUT', '/me', { today, preferences: { likedFoods: ['poulet', 'riz'], limitedFoods: ['dinde'], excludedTags: ['legume', 'poisson'] } });
st = (await call('PUT', '/me', { today, preferences: { level: 'meal-prep' } })).json;
const after = st.user.preferences;
ok(
  'mise a jour partielle des preferences',
  after.level === 'meal-prep' && after.likedFoods.join() === 'poulet,riz' && after.limitedFoods.join() === 'dinde' && after.excludedTags.includes('poisson') && after.equipment.length === before.equipment.length && after.meals.join() === before.meals.join(),
  `liked=${after.likedFoods.length} limited=${after.limitedFoods.length} tags=${after.excludedTags.join('/')} equipment=${after.equipment.length}`,
);
st = (await call('POST', '/meal-plans/generate', { today, weekStart: nextMonday })).json;
const fishy = st.nextPlan.days.flatMap((d) => d.meals).flatMap((m) => m.items).filter((i) => ['saumon', 'poisson-blanc', 'thon'].includes(i.foodId));
const turkey = st.nextPlan.days.flatMap((d) => d.meals).filter((m) => m.items.some((i) => i.foodId === 'dinde'));
ok('sans poisson + dinde rarement', fishy.length === 0 && turkey.length <= 1, `poisson=${fishy.length} repas avec dinde=${turkey.length}`);
const exp = (await call('GET', '/me/export')).json;
ok('export RGPD', !!exp.user && Array.isArray(exp.MealPlan), Object.entries(exp).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k}:${v.length}`).join(' '));
ok('swagger', !!(await call('GET', '/docs-json')).json?.paths);

// Session de courses : sync puis clôture
const openList = st.shoppingLists.find((l) => l.weekStart === nextMonday);
const core = await import('@bouffe/core');
let session = core.createSession('smoke-' + Date.now(), openList.id, openList, { id: st.stores[0].id, name: st.stores[0].name, aisleOrder: st.stores[0].aisleOrder }, new Date().toISOString());
const first = session.items[0];
session = core.addScan(session, first.id, { lineId: 'l1', product: { ean: '3250391234561', name: `${first.name} (test)`, grams: first.planned[0].grams, price: 4.79, foodId: first.foodId, source: 'manual' }, qty: core.plannedUnits(first), at: new Date().toISOString() });
for (const item of session.items.slice(1, -2)) session = core.setManualDone(session, item.id, true, new Date().toISOString());
const sync = await call('PUT', `/shopping-sessions/${session.id}`, { session });
ok('sync session', sync.status === 200 && sync.json.items.length === session.items.length);
const fin = (await call('POST', `/shopping-sessions/${session.id}/finish`, { today, session })).json;
ok('terminer les courses', fin.purchase?.missing?.length === 2, `prevu=${fin.purchase.plannedTotal} reel=${fin.purchase.actualTotal} economie=${fin.purchase.saving} achetes=${fin.purchase.itemsBought}/${fin.purchase.itemsPlanned}`);
const invFin = inv(fin.state);
ok('achats ajoutes aux stocks', (invFin[first.foodId] ?? 0) >= first.neededG, `${first.foodId}: ${invFin[first.foodId]} g`);
const again = (await call('POST', `/shopping-sessions/${session.id}/finish`, { today, session })).json;
ok('cloture idempotente', again.purchase.id === fin.purchase.id);
const known = (await call('GET', '/barcodes/3250391234561')).json;
ok('produit scanne memorise avec son prix', known.product?.price === 4.79, `${known.product?.name} via ${known.attempts.map((a) => `${a.resolver}:${a.status}`).join(' > ')}`);
ok('liste cloturee', fin.state.shoppingLists.find((l) => l.id === openList.id).status === 'done');

// ── Nouveautés : cadenas, échange, repas libre, recettes et produits personnels, entraînement ──
st = (await call('PUT', '/me', { today, preferences: { style: 'cuisine', level: 'normal', cookOnce: true, awayPrepAhead: true, trainingDays: [true, false, true, false, true, false, false], trainingBonusKcal: 200 } })).json;
st = (await call('POST', '/meal-plans/generate', { today, weekStart: nextMonday, away: Array(7).fill('none') })).json;
let np = st.nextPlan;
ok(
  'style cuisine : des plats avec recette, la semaine deja generee garde le sien',
  st.user.preferences.style === 'cuisine' && np.style === 'cuisine' && np.days.flatMap((d) => d.meals).every((m) => !m.templateId.startsWith('simple-')) && st.plan.style === 'simple',
);
const dayKcal = (d) => (d.baseKcal ?? np.target.kcal) + (d.spreadKcal ?? 0);
ok(
  "jours d'entrainement : cible propre a chaque jour",
  np.days[0].training === true && np.days[0].baseKcal > np.days[1].baseKcal && np.days.every((d) => Math.abs(d.nutrition.kcal - dayKcal(d)) <= 50),
  np.days.map((d) => `${d.nutrition.kcal}/${dayKcal(d)}`).join(' '),
);
const pairs = core.cookOncePairs(np);
ok('cuisiner une fois, manger deux fois', pairs.length >= 3, `${pairs.length} diner(s) reconduit(s) au dejeuner du lendemain`);
// Saveurs : le catalogue servi permet des variantes assaisonnées (leur présence dans une semaine donnée
// dépend du tirage : elle est mesurée par les tests unitaires, pas exigée ici).
const catalogue = (await call('GET', `/state?today=${today}&catalog=1`)).json;
const dishes = core.countPossibleDishes(catalogue.foods, catalogue.templates, { excludedFoods: [], excludedTags: ['legume', 'poisson'], bannedTemplates: [] });
const seasoned = [...st.plan.days, ...np.days].flatMap((d) => d.meals).filter((m) => m.items.some((i) => i.slotKey === 'seasoning'));
ok(
  'saveurs',
  dishes.mainsHomeFlavored > dishes.mainsHome && catalogue.foods.filter((f) => f.category === 'epice').length >= 7,
  `${dishes.mainsHome} plats, ${dishes.mainsHomeFlavored} avec assaisonnements ; cette fois : ${seasoned.map((m) => m.name).slice(0, 3).join(' | ') || 'aucun plat assaisonne tire'}`,
);
ok(
  'valeurs de la table Ciqual servies par le catalogue',
  catalogue.foods.find((f) => f.id === 'poulet')?.ciqual?.code === '36017' && catalogue.foods.find((f) => f.id === 'poulet').per100.protein === 23.4 && !catalogue.foods.find((f) => f.id === 'skyr').ciqual,
  `${catalogue.foods.filter((f) => f.ciqual).length} aliments sur ${catalogue.foods.length} viennent de la table`,
);

const keepMeal = np.days[3].meals[2];
await call('POST', `/meal-plans/${np.id}/meals/${keepMeal.id}/lock`, { locked: true });
st = (await call('POST', '/meal-plans/generate', { today, weekStart: nextMonday, away: Array(7).fill('none') })).json;
np = st.nextPlan;
const changedMeals = np.days.flatMap((d) => d.meals).filter((m) => m.id !== keepMeal.id).length;
ok('cadenas : repas conserve a la regeneration', np.days[3].meals[2].id === keepMeal.id && np.days[3].meals[2].locked === true && changedMeals === 20, np.days[3].meals[2].name);

const a = np.days[0].meals[2];
const b = np.days[5].meals[2];
st = (await call('POST', `/meal-plans/${np.id}/swap`, { today, mealId: a.id, otherMealId: b.id })).json;
np = st.nextPlan;
ok('echange de deux repas', np.days[0].meals[2].signature === b.signature && np.days[5].meals[2].signature === a.signature && np.days.every((d) => Math.abs(d.nutrition.kcal - dayKcal(d)) <= 50), `${a.name} <> ${b.name}`);

// Repas libre sur le programme de la semaine en cours, puis annulation.
let cp = st.plan;
const freeDay = cp.days.findIndex((d) => d.date === today);
const freeMeal = cp.days[freeDay].meals[0];
const freed = (await call('POST', `/meal-plans/${cp.id}/meals/${freeMeal.id}/free`, { today, kcal: 1900, label: 'Restaurant' })).json;
cp = freed.state.plan;
const later = cp.days.filter((d) => d.index > freeDay);
ok(
  'repas libre lisse sur la semaine',
  cp.days[freeDay].meals[0].status === 'replaced' && cp.days[freeDay].meals[0].free?.kcal === 1900 && freed.report.surplusKcal > 0 && (later.length === 0 || later.every((d) => (d.spreadKcal ?? 0) <= 0 && (d.spreadKcal ?? 0) >= -150)),
  `excedent=${freed.report.surplusKcal} reparti=${freed.report.absorbedKcal} sur ${freed.report.days.length} jour(s) : ${freed.report.days.map((d) => d.deltaKcal).join(' ')}`,
);
const realToday = freed.state.entries.filter((e) => e.date === today).reduce((sum, e) => sum + e.nutrition.kcal, 0);
ok('repas libre compte dans le reel', Math.round(realToday) === 1900);
st = (await call('DELETE', `/meal-plans/${cp.id}/meals/${freeMeal.id}/log?today=${today}`)).json;
ok('annuler le repas libre annule le lissage', st.plan.days.every((d) => !d.spreadKcal) && st.plan.days[freeDay].meals[0].status === 'planned' && !st.plan.days[freeDay].meals[0].free);

// Recette personnelle.
const myRecipe = { name: 'Poulet coco du test', meal: 'main', away: false, dessert: true, prepMin: 5, cookMin: 15, steps: ['Saisir le poulet.', 'Ajouter la creme.'], ingredients: [{ foodId: 'poulet', role: 'protein' }, { foodId: 'riz', role: 'energy' }, { foodId: 'creme-legere', role: 'fixed', grams: 60 }] };
st = (await call('POST', '/recipes', { recipe: myRecipe })).json;
const mine = st.customRecipes?.[0];
ok('recette personnelle', !!mine && st.templates.some((t) => t.id === mine.id && t.custom), mine?.id);
ok('recette invalide = 422', (await call('POST', '/recipes?expect', { recipe: { ...myRecipe, ingredients: [] } })).status === 422);
st = (await call('DELETE', `/recipes/${mine.id}`)).json;
ok('suppression de la recette', st.customRecipes.length === 0 && !st.templates.some((t) => t.id === mine.id));

// Mes vrais produits : valeurs de l'etiquette a la place des valeurs generiques.
const skyrBefore = st.foods.find((f) => f.id === 'skyr');
st = (await call('POST', '/foods', { today, food: { id: 'skyr', per100: { kcal: 64, protein: 11, carbs: 4, fat: 0.2 }, pieceGrams: 150, productName: 'Skyr de test 150 g' } })).json;
const skyrAfter = st.foods.find((f) => f.id === 'skyr');
ok(
  'mes vrais produits : valeurs remplacees, programme recalcule',
  skyrAfter.custom === true && skyrAfter.per100.protein === 11 && skyrAfter.piece.grams === 150 && st.nextPlan.days.every((d) => Math.abs(d.nutrition.kcal - ((d.baseKcal ?? 2300) + (d.spreadKcal ?? 0))) <= 50),
  `${skyrBefore.per100.kcal} > ${skyrAfter.per100.kcal} kcal, pot ${skyrBefore.piece.grams} > ${skyrAfter.piece.grams} g`,
);
ok('valeurs incompletes = 400', (await call('POST', '/foods?expect', { food: { id: 'skyr', per100: { kcal: 64 } } })).status === 400);
st = (await call('DELETE', `/foods/skyr?today=${today}`)).json;
ok('retour aux valeurs du catalogue', !st.foods.find((f) => f.id === 'skyr').custom && st.foods.find((f) => f.id === 'skyr').per100.kcal === skyrBefore.per100.kcal);
st = (await call('POST', '/foods', { today, food: { name: 'Galettes de riz du test', category: 'feculent', per100: { kcal: 385, protein: 8, carbs: 81, fat: 2.8, fiber: 3 }, pieceGrams: 9 } })).json;
ok('aliment personnel ajoute', st.foods.some((f) => f.custom && f.name === 'Galettes de riz du test' && f.piece?.grams === 9));

// Un aliment personnel encore utilise par une recette ne se supprime pas (sinon : repas incalculables).
const ownFood = st.foods.find((f) => f.name === 'Galettes de riz du test');
st = (await call('POST', '/recipes', { recipe: { name: 'Galettes skyr du test', meal: 'snack', away: false, dessert: false, prepMin: 2, cookMin: 0, steps: ['Tartiner.'], ingredients: [{ foodId: ownFood.id, role: 'fixed', grams: 27 }, { foodId: 'skyr', role: 'protein' }] } })).json;
const snack = st.customRecipes.find((r) => r.name === 'Galettes skyr du test');
ok('aliment utilise par une recette = 409', (await call('DELETE', `/foods/${ownFood.id}?today=${today}#expect`)).status === 409);
await call('DELETE', `/recipes/${snack.id}`);
st = (await call('DELETE', `/foods/${ownFood.id}?today=${today}`)).json;
ok('aliment personnel supprime une fois libre', !st.foods.some((f) => f.id === ownFood.id));

} catch (error) {
  failures++;
  console.log('FAIL erreur inattendue :', error);
}

const removed = await call('DELETE', '/me', { password });
ok('suppression du compte de test', removed.status === 204 && (await call('POST', '/auth/login?expect', { email, password })).status === 401);

console.log(failures === 0 ? '\nTout est vert.' : `\n${failures} vérification(s) en échec.`);
process.exitCode = failures === 0 ? 0 : 1;
