/**
 * État de l'application (Signals), « offline-first ».
 *
 * 1. Au démarrage, l'état est restauré depuis IndexedDB : programme et liste de courses
 *    s'affichent immédiatement, même sans réseau.
 * 2. Il est ensuite rafraîchi depuis l'API ; chaque mutation renvoie l'état complet à jour.
 * 3. Hors connexion, les actions du quotidien (repas mangé, article coché, pesée) sont appliquées
 *    localement et placées dans une file, rejouée dès que la connexion revient.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import {
  type AwayMode,
  type CustomRecipeInput,
  type Food,
  type Meal,
  type MealPlanDay,
  type MealStatus,
  type NutritionTarget,
  type Nutrients,
  type PrepLevel,
  type ShoppingStrategy,
  type SpreadReport,
  ZERO,
  addDays,
  addNutrients,
  applyStock,
  dayTargetKcal,
  indexFoods,
  mondayOf,
  nutrientsFor,
  roundNutrients,
  snapshotNutrients,
  summarizeWeight,
  toISODate,
} from '@bouffe/core';
import { Api, ApiError, OfflineError } from './api';
import { LocalDb } from './db';
import type { AppState, EntryJson, OutboxItem, PlanJson, ShoppingListJson } from './models';
import { Toasts } from './toasts';

const STATE_KEY = 'state';
const OUTBOX_KEY = 'outbox';

function uid(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

@Injectable({ providedIn: 'root' })
export class Store {
  private readonly api = inject(Api);
  private readonly db = inject(LocalDb);
  private readonly toasts = inject(Toasts);

  readonly state = signal<AppState | null>(null);
  readonly ready = signal(false);
  readonly busy = signal(false);
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly outbox = signal<OutboxItem[]>([]);
  readonly today = signal(toISODate(new Date()));
  /** Semaine affichée dans Programme et Courses. */
  readonly week = signal<'current' | 'next'>('current');

  // ───────────── Sélecteurs ─────────────

  readonly user = computed(() => this.state()?.user ?? null);
  readonly goal = computed(() => this.state()?.goal ?? null);
  readonly foodList = computed<Food[]>(() => this.state()?.foods ?? []);
  readonly foods = computed(() => indexFoods(this.foodList()));
  readonly templates = computed(() => this.state()?.templates ?? []);
  readonly currentStore = computed(() => {
    const s = this.state();
    return s?.stores.find((x) => x.id === s.user.preferences.storeId) ?? s?.stores[0] ?? null;
  });

  readonly currentPlan = computed(() => this.state()?.plan ?? null);
  readonly nextPlan = computed(() => this.state()?.nextPlan ?? null);
  readonly plan = computed<PlanJson | null>(() => (this.week() === 'next' ? this.nextPlan() : this.currentPlan()));
  readonly weekStart = computed(() => {
    const monday = mondayOf(this.today());
    return this.week() === 'current' ? monday : addDays(monday, 7);
  });

  readonly list = computed<ShoppingListJson | null>(() => {
    const plan = this.plan();
    return this.state()?.shoppingLists.find((l) => l.weekStart === plan?.weekStart) ?? null;
  });

  readonly todayDay = computed<MealPlanDay | null>(() => this.currentPlan()?.days.find((d) => d.date === this.today()) ?? null);
  readonly inventory = computed(() => Object.fromEntries((this.state()?.inventory ?? []).map((i) => [i.foodId, i.grams])));
  readonly target = computed<NutritionTarget>(() => this.goal() ?? { kcal: 2300, protein: 180, toleranceKcal: 50, fiberGuide: 25 });

  /** Cible d'un jour : budget de la semaine, ajusté pour l'entraînement ou un repas libre lissé. */
  targetFor(date: string): NutritionTarget {
    for (const plan of [this.currentPlan(), this.nextPlan()]) {
      const day = plan?.days.find((d) => d.date === date);
      if (plan && day) return { ...plan.target, kcal: dayTargetKcal(plan, day) };
    }
    return this.target();
  }

  readonly todayTarget = computed(() => this.targetFor(this.today()));

  entriesFor(date: string): EntryJson[] {
    return (this.state()?.entries ?? []).filter((e) => e.date === date);
  }

  consumed(date: string): Nutrients {
    return roundNutrients(this.entriesFor(date).reduce((sum, e) => addNutrients(sum, e.nutrition), { ...ZERO }));
  }

  readonly consumedToday = computed(() => this.consumed(this.today()));

  /** Moyennes réelles sur les jours de la semaine en cours où quelque chose a été déclaré. */
  readonly weekAverages = computed(() => {
    const monday = mondayOf(this.today());
    const days = new Map<string, Nutrients>();
    for (const e of this.state()?.entries ?? []) {
      if (e.date < monday || e.date > this.today()) continue;
      days.set(e.date, addNutrients(days.get(e.date) ?? { ...ZERO }, e.nutrition));
    }
    if (days.size === 0) return null;
    const total = [...days.values()].reduce(addNutrients, { ...ZERO });
    return { days: days.size, kcal: Math.round(total.kcal / days.size), protein: Math.round(total.protein / days.size) };
  });

  // ───────────── Cycle de vie ─────────────

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.online.set(true);
        void this.flush();
      });
      window.addEventListener('offline', () => this.online.set(false));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        const now = toISODate(new Date());
        if (now !== this.today()) this.today.set(now);
        if (this.state()) void this.refresh();
      });
    }
  }

  /** Restaure le cache local puis rafraîchit depuis le serveur. */
  async init(): Promise<void> {
    const [cached, outbox] = await Promise.all([this.db.get<AppState>(STATE_KEY), this.db.get<OutboxItem[]>(OUTBOX_KEY)]);
    if (cached) this.state.set(cached);
    if (outbox?.length) this.outbox.set(outbox);
    if (this.api.hasSession()) {
      const sync = this.flush().then(() => this.refresh(true));
      // Avec un cache local, l'application s'affiche tout de suite et se met à jour en arrière-plan.
      if (!cached) await sync;
    }
    this.ready.set(true);
  }

  private apply(next: AppState): void {
    const previous = this.state();
    const merged: AppState = {
      ...next,
      foods: next.foods ?? previous?.foods,
      templates: next.templates ?? previous?.templates,
      knownBarcodes: next.knownBarcodes ?? previous?.knownBarcodes,
      customRecipes: next.customRecipes ?? previous?.customRecipes,
    };
    this.state.set(merged);
    void this.db.set(STATE_KEY, merged);
  }

  private patch(update: (state: AppState) => AppState): void {
    const current = this.state();
    if (!current) return;
    const next = update(current);
    this.state.set(next);
    void this.db.set(STATE_KEY, next);
  }

  async refresh(catalog = false): Promise<boolean> {
    try {
      const needCatalog = catalog || !this.state()?.foods?.length;
      this.apply(await this.api.get<AppState>(`/state?today=${this.today()}${needCatalog ? '&catalog=1' : ''}`));
      this.online.set(true);
      return true;
    } catch (error) {
      if (error instanceof OfflineError) this.online.set(false);
      else if (error instanceof ApiError && error.status === 401) this.state.set(null);
      return false;
    }
  }

  async signOut(): Promise<void> {
    await this.api.logout();
    await this.db.clear();
    this.state.set(null);
    this.outbox.set([]);
  }

  // ───────────── Mutations ─────────────

  /**
   * Exécute une action serveur qui renvoie le nouvel état.
   * Si `offline` est fourni et que le réseau est absent, l'action est appliquée localement
   * et mise en file pour synchronisation.
   */
  private async run(
    action: () => Promise<AppState>,
    offline?: { item: Omit<OutboxItem, 'id' | 'at'>; optimistic: (state: AppState) => AppState },
  ): Promise<boolean> {
    this.busy.set(true);
    try {
      this.apply(await action());
      this.online.set(true);
      return true;
    } catch (error) {
      if (error instanceof OfflineError) {
        this.online.set(false);
        if (offline) {
          this.patch(offline.optimistic);
          this.enqueue(offline.item);
          return true;
        }
        this.toasts.error('Connexion requise pour cette action.');
      } else {
        this.toasts.error(error instanceof Error ? error.message : 'Une erreur est survenue.');
      }
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private enqueue(item: Omit<OutboxItem, 'id' | 'at'>): void {
    const next = [...this.outbox(), { ...item, id: uid(), at: new Date().toISOString() }];
    this.outbox.set(next);
    void this.db.set(OUTBOX_KEY, next);
    this.toasts.info('Enregistré hors ligne — synchronisation au retour du réseau.');
  }

  /** Met une requête en file (utilisé aussi par le mode Courses). */
  queue(item: Omit<OutboxItem, 'id' | 'at'>): void {
    this.enqueue(item);
  }

  /** Rejoue la file des modifications faites hors ligne, dans l'ordre. */
  async flush(): Promise<void> {
    let queue = this.outbox();
    if (queue.length === 0) return;
    let sent = 0;
    while (queue.length > 0) {
      const item = queue[0]!;
      try {
        await this.api.request(item.method, item.path, item.body);
        sent++;
      } catch (error) {
        if (error instanceof OfflineError) break;
        // Refus définitif du serveur (ex. donnée devenue invalide) : on n'insiste pas.
        this.toasts.error(`Synchronisation impossible : ${item.label}`);
      }
      queue = queue.slice(1);
      this.outbox.set(queue);
      await this.db.set(OUTBOX_KEY, queue);
    }
    if (sent > 0) {
      this.toasts.success(`${sent} modification${sent > 1 ? 's' : ''} synchronisée${sent > 1 ? 's' : ''}.`);
      await this.refresh();
    }
  }

  private post = (path: string, body: Record<string, unknown> = {}) => this.api.request<AppState>('POST', path, { today: this.today(), ...body });

  // Programme

  generateWeek(options: { weekStart: string; away?: AwayMode[]; level?: PrepLevel }): Promise<boolean> {
    return this.run(() => this.post('/meal-plans/generate', options));
  }

  alternatives(planId: string, mealId: string): Promise<Meal[]> {
    return this.api.get<Meal[]>(`/meal-plans/${planId}/meals/${mealId}/alternatives`);
  }

  replaceMeal(planId: string, mealId: string, replacement?: Pick<Meal, 'templateId' | 'items'>): Promise<boolean> {
    return this.run(() => this.post(`/meal-plans/${planId}/meals/${mealId}/replace`, replacement ? { replacement } : {}));
  }

  foodAlternatives(planId: string, mealId: string, slotKey: string) {
    return this.api.get<{ foodId: string; name: string; grams: number; mealNutrition: Nutrients }[]>(
      `/meal-plans/${planId}/meals/${mealId}/items/${slotKey}/alternatives`,
    );
  }

  replaceFood(planId: string, mealId: string, slotKey: string, foodId: string): Promise<boolean> {
    return this.run(() => this.post(`/meal-plans/${planId}/meals/${mealId}/items/${slotKey}/replace`, { foodId }));
  }

  setAway(planId: string, dayIndex: number, away: AwayMode): Promise<boolean> {
    return this.run(() => this.api.request<AppState>('PATCH', `/meal-plans/${planId}/days/${dayIndex}`, { today: this.today(), away }));
  }

  rebalance(planId: string, dayIndex: number): Promise<boolean> {
    return this.run(() => this.post(`/meal-plans/${planId}/days/${dayIndex}/rebalance`));
  }

  feedback(planId: string, mealId: string, body: { rating?: number; favorite?: boolean; banned?: boolean }): Promise<boolean> {
    return this.run(() => this.post(`/meal-plans/${planId}/meals/${mealId}/feedback`, body));
  }

  repeatMeal(planId: string, mealId: string, targetMealId: string): Promise<boolean> {
    return this.run(() => this.post(`/meal-plans/${planId}/meals/${mealId}/repeat`, { targetMealId }));
  }

  /** Pose ou retire le cadenas : le repas est gardé quand on régénère la semaine. */
  lockMeal(planId: string, mealId: string, locked: boolean): Promise<boolean> {
    return this.run(() => this.post(`/meal-plans/${planId}/meals/${mealId}/lock`, { locked }));
  }

  swapMeals(planId: string, mealId: string, otherMealId: string): Promise<boolean> {
    return this.run(() => this.post(`/meal-plans/${planId}/swap`, { mealId, otherMealId }));
  }

  /** Déclare un repas libre ; renvoie comment l'écart a été réparti sur la semaine. */
  async freeMeal(planId: string, mealId: string, body: { kcal: number; protein?: number; label?: string; spread: boolean }): Promise<SpreadReport | null> {
    this.busy.set(true);
    try {
      const result = await this.api.request<{ report: SpreadReport; state: AppState }>('POST', `/meal-plans/${planId}/meals/${mealId}/free`, { today: this.today(), ...body });
      this.apply(result.state);
      this.online.set(true);
      return result.report;
    } catch (error) {
      if (error instanceof OfflineError) {
        this.online.set(false);
        this.toasts.error('Connexion requise pour déclarer un repas libre.');
      } else {
        this.toasts.error(error instanceof Error ? error.message : 'Une erreur est survenue.');
      }
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  saveRecipe(recipe: CustomRecipeInput): Promise<boolean> {
    return this.run(() => this.api.request<AppState>('POST', '/recipes', { recipe }));
  }

  deleteRecipe(id: string): Promise<boolean> {
    return this.run(() => this.api.request<AppState>('DELETE', `/recipes/${id}`));
  }

  /** « Mes vrais produits » : valeurs de l'étiquette pour un aliment, ou nouvel aliment personnel. */
  saveFood(food: Record<string, unknown>): Promise<boolean> {
    return this.run(() => this.api.request<AppState>('POST', '/foods', { today: this.today(), food }));
  }

  resetFood(key: string): Promise<boolean> {
    return this.run(() => this.api.request<AppState>('DELETE', `/foods/${key}?today=${this.today()}`));
  }

  /** Déclare ce qui a été mangé. Fonctionne hors ligne pour « mangé », « sauté » et l'annulation. */
  logMeal(
    planId: string,
    meal: Meal,
    date: string,
    status: MealStatus,
    items?: { foodId: string; grams: number }[],
    rebalance = false,
  ): Promise<boolean> {
    const path = `/meal-plans/${planId}/meals/${meal.id}/log`;
    const body = { today: this.today(), status, items, rebalance };
    const eaten = status === 'eaten' ? meal.items.map((i) => ({ foodId: i.foodId, grams: i.grams })) : (items ?? []);
    const foods = this.foods();
    return this.run(() => this.api.request<AppState>('POST', path, body), {
      item: { method: 'POST', path, body, label: `repas « ${meal.name} »` },
      optimistic: (state) => {
        const entries: EntryJson[] = eaten.flatMap((item) => {
          const food = foods.get(item.foodId);
          if (!food) return [];
          return [
            {
              id: `local-${uid()}`,
              date,
              slot: meal.slot,
              mealId: meal.id,
              planId,
              foodKey: food.id,
              name: food.name,
              grams: item.grams,
              nutrition: snapshotNutrients(nutrientsFor(food, item.grams)),
              source: 'plan' as const,
            },
          ];
        });
        const touch = (plan: PlanJson | null): PlanJson | null =>
          plan && plan.id === planId
            ? { ...plan, days: plan.days.map((d) => ({ ...d, meals: d.meals.map((m) => (m.id === meal.id ? { ...m, status } : m)) })) }
            : plan;
        return {
          ...state,
          plan: touch(state.plan),
          nextPlan: touch(state.nextPlan),
          entries: [...state.entries.filter((e) => e.mealId !== meal.id), ...entries],
        };
      },
    });
  }

  addEntry(date: string, slot: string, foodId: string, grams: number): Promise<boolean> {
    return this.run(() => this.post('/entries', { date, slot, foodId, grams }));
  }

  deleteEntry(id: string): Promise<boolean> {
    return this.run(() => this.api.request<AppState>('DELETE', `/entries/${id}?today=${this.today()}`));
  }

  // Courses & stocks

  regenerateList(weekStart: string, strategy?: ShoppingStrategy): Promise<boolean> {
    return this.run(() => this.post('/shopping-lists/generate', { weekStart, strategy }));
  }

  /** Coche un article : immédiat et disponible hors ligne. */
  async checkItem(list: ShoppingListJson, itemId: string, checked: boolean): Promise<void> {
    const path = `/shopping-lists/${list.id}/items/${itemId}`;
    this.patch((state) => ({
      ...state,
      shoppingLists: state.shoppingLists.map((l) =>
        l.id === list.id ? { ...l, items: l.items.map((i) => (i.id === itemId ? { ...i, checked } : i)) } : l,
      ),
    }));
    try {
      await this.api.request('PATCH', path, { checked });
    } catch (error) {
      if (error instanceof OfflineError) {
        this.online.set(false);
        const pending = this.outbox().filter((o) => o.path !== path);
        this.outbox.set(pending);
        this.enqueue({ method: 'PATCH', path, body: { checked }, label: 'article coché' });
      }
    }
  }

  /** Vrai tant que des modifications du stock attendent d'être enregistrées. */
  readonly stockSaving = signal(false);
  private pendingStock: Record<string, number> = {};
  private stockTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Fixe le stock d'un ou plusieurs aliments (0 = retiré). L'écran est à jour tout de suite ; les
   * modifications rapprochées partent en un seul envoi, et le serveur recalcule la liste de courses.
   * Fonctionne hors ligne (mis en file).
   */
  setStock(stock: Record<string, number>): void {
    this.patch((state) => ({ ...state, inventory: applyStock(state.inventory, stock) }));
    Object.assign(this.pendingStock, stock);
    this.stockSaving.set(true);
    if (this.stockTimer) clearTimeout(this.stockTimer);
    this.stockTimer = setTimeout(() => void this.flushStock(), 700);
  }

  /** Envoie tout de suite les modifications du stock en attente (appelé aussi en quittant l'écran). */
  async flushStock(): Promise<void> {
    if (this.stockTimer) clearTimeout(this.stockTimer);
    this.stockTimer = null;
    const stock = this.pendingStock;
    this.pendingStock = {};
    if (Object.keys(stock).length === 0) return;
    const body = { today: this.today(), stock };
    try {
      const next = await this.api.request<AppState>('PUT', '/inventory', body);
      // Des gestes ont pu arriver pendant l'envoi : ils restent visibles et partiront au prochain envoi.
      const waiting = this.pendingStock;
      this.apply(Object.keys(waiting).length ? { ...next, inventory: applyStock(next.inventory, waiting) } : next);
      this.online.set(true);
    } catch (error) {
      if (error instanceof OfflineError) {
        this.online.set(false);
        this.enqueue({ method: 'PUT', path: '/inventory', body, label: 'stock' });
      } else {
        this.toasts.error(error instanceof Error ? error.message : "Le stock n'a pas pu être enregistré.");
        void this.refresh();
      }
    } finally {
      if (Object.keys(this.pendingStock).length === 0) this.stockSaving.set(false);
    }
  }

  /** Retient qu'un code-barres correspond à un aliment (scan à la maison). Sans importance si cela échoue. */
  async learnBarcode(ean: string, product: { name: string; brand?: string; grams: number; foodId: string; variableWeight?: boolean }): Promise<void> {
    try {
      await this.api.request('PUT', `/barcodes/${ean}`, product);
    } catch {
      /* le produit reste connu de l'appareil ; il sera redemandé sur un autre */
    }
  }

  setInventory(foodId: string, grams: number): Promise<boolean> {
    return this.run(() => this.api.request<AppState>('PUT', `/inventory/${foodId}`, { today: this.today(), grams }));
  }

  saveRetailProduct(product: Record<string, unknown>): Promise<boolean> {
    return this.run(() => this.api.request<AppState>('PUT', `/retail-products?today=${this.today()}`, product));
  }

  deleteRetailProduct(id: string): Promise<boolean> {
    return this.run(() => this.api.request<AppState>('DELETE', `/retail-products/${id}?today=${this.today()}`));
  }

  applyHabit(habit: { foodId: string; packGrams?: number; brand?: string; price?: number }): Promise<boolean> {
    return this.run(() => this.post('/shopping/habits/apply', habit));
  }

  setAisleOrder(storeId: string, aisleOrder: string[]): Promise<boolean> {
    return this.run(() => this.api.request<AppState>('PATCH', `/stores/${storeId}?today=${this.today()}`, { aisleOrder }));
  }

  /** Remplace l'état par celui renvoyé à la clôture des courses. */
  adopt(state: AppState): void {
    this.apply(state);
  }

  // Suivi

  /** Enregistre une pesée : disponible hors ligne. */
  setWeight(date: string, kg: number): Promise<boolean> {
    const path = `/weights/${date}`;
    const body = { today: this.today(), kg };
    return this.run(() => this.api.request<AppState>('PUT', path, body), {
      item: { method: 'PUT', path, body, label: `pesée du ${date}` },
      optimistic: (state) => {
        const weights = [...state.weights.filter((w) => w.date !== date), { date, kg, source: 'manual' }].sort((a, b) => a.date.localeCompare(b.date));
        const profile = state.user.profile;
        return {
          ...state,
          weights,
          weightSummary: profile ? summarizeWeight(weights, profile.startWeightKg, profile.goalWeightKg, this.today()) : state.weightSummary,
        };
      },
    });
  }

  deleteWeight(date: string): Promise<boolean> {
    return this.run(() => this.api.request<AppState>('DELETE', `/weights/${date}?today=${this.today()}`));
  }

  setActivity(date: string, body: Record<string, unknown>): Promise<boolean> {
    return this.run(() => this.api.request<AppState>('PUT', `/activities/${date}`, { today: this.today(), ...body }));
  }

  // Profil

  updateMe(body: Record<string, unknown>): Promise<boolean> {
    return this.run(() => this.api.request<AppState>('PUT', '/me', { today: this.today(), ...body }));
  }

  setGoal(kcal: number, protein: number, reason: 'manual' | 'suggestion' = 'manual'): Promise<boolean> {
    return this.run(() => this.post('/me/goal', { kcal, protein, reason }));
  }

  onboard(body: Record<string, unknown>): Promise<boolean> {
    return this.run(() => this.post('/me/onboarding', body));
  }

  createStore(name: string, city?: string): Promise<boolean> {
    return this.run(() => this.api.request<AppState>('POST', '/stores', { name, city }));
  }
}
