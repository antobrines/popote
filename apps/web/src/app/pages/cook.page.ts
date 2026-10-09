import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DAY_LABELS, SLOT_LABELS, buildRecipe, cookedGrams, cookedItems, formatGrams, ingredientLabel } from '@bouffe/core';
import { batchInfo, combinedForCooking } from '../core/batch';
import { Store } from '../core/store';
import { Toasts } from '../core/toasts';
import { Icon, NumPipe } from '../ui/ui';

interface StepTimer {
  seconds: number;
  /** Le passage du texte qui a donné la durée (« 12 à 14 min »). */
  label: string;
}

interface CookStep {
  kind: 'ingredients' | 'step' | 'aside' | 'done';
  text: string;
  timer: StepTimer | null;
}

interface TimerState {
  total: number;
  /** Secondes restantes quand le minuteur est en pause. */
  left: number;
  /** Horodatage de fin quand il tourne (insensible au ralentissement d'un onglet en arrière-plan). */
  endsAt: number | null;
  done: boolean;
}

/** « 12 à 14 min », « 3 à 4 min par face », « 20 min » : on part de la durée basse, quitte à prolonger. */
function parseTimer(text: string): StepTimer | null {
  const match = /(\d+)(?:\s*(?:à|-|–)\s*\d+)?\s*min(?:utes?)?\b(?:\s+par face)?/i.exec(text);
  if (!match) return null;
  const minutes = Number(match[1]);
  if (!minutes || minutes > 180) return null;
  return { seconds: minutes * 60, label: match[0].trim() };
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Mode cuisine : la recette plein écran, une étape à la fois, lisible à bout de bras.
 * Minuteurs détectés dans le texte des étapes, écran maintenu allumé quand le navigateur le permet.
 */
@Component({
  selector: 'app-cook-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, NumPipe],
  host: { '(document:keydown.arrowright)': 'next()', '(document:keydown.arrowleft)': 'previous()' },
  template: `
    <div class="mx-auto flex min-h-dvh w-full max-w-[34rem] flex-col px-5" style="padding-top: calc(env(safe-area-inset-top) + 1rem); padding-bottom: calc(env(safe-area-inset-bottom) + 1rem)">
      <header class="row">
        <button type="button" class="grid size-11 shrink-0 place-items-center rounded-full bg-card" (click)="close()" aria-label="Quitter le mode cuisine">
          <app-icon name="x" [size]="18" />
        </button>
        <div class="min-w-0 flex-1 text-center">
          <p class="eyebrow">{{ slotLabel() }}</p>
          <p class="truncate font-semibold">{{ meal()?.name ?? 'Mode cuisine' }}</p>
        </div>
        <span
          class="grid size-11 shrink-0 place-items-center rounded-full"
          [class]="awake() ? 'bg-accent-soft text-accent' : 'bg-card text-faint'"
          role="img"
          [attr.aria-label]="awake() ? 'Écran maintenu allumé' : 'Ton navigateur ne permet pas de garder l’écran allumé'"
          [attr.title]="awake() ? 'Écran maintenu allumé' : 'Écran non maintenu allumé'"
        >
          <app-icon name="sun" [size]="18" />
        </span>
      </header>

      @if (recipe(); as r) {
        <div class="mt-4 flex gap-1" aria-hidden="true">
          @for (s of steps(); track $index) {
            <span class="h-1 flex-1 rounded-full transition-colors" [class]="$index <= index() ? 'bg-accent' : 'bg-raised'"></span>
          }
        </div>

        @if (others().length > 0) {
          <div class="mt-3 flex flex-wrap gap-1.5" aria-label="Minuteurs en cours">
            @for (t of others(); track t.step) {
              <button type="button" class="chip num" [class]="t.done ? '!bg-accent !text-on-accent' : ''" (click)="index.set(t.step)">
                <app-icon name="clock" [size]="14" />
                Étape {{ t.number }} · {{ t.done ? 'terminé' : t.clock }}
              </button>
            }
          </div>
        }

        <main class="flex flex-1 flex-col justify-center py-6" aria-live="polite">
          @if (step(); as s) {
            @switch (s.kind) {
              @case ('ingredients') {
                <section class="fade-in space-y-4">
                  <div>
                    <p class="eyebrow">Avant de commencer</p>
                    <h1 class="title mt-1">Sors tes ingrédients</h1>
                    <p class="num mt-2 text-muted">
                      {{ r.prepMin + r.cookMin }} min au total · {{ r.steps.length }} étape{{ r.steps.length > 1 ? 's' : '' }}
                    </p>
                  </div>
                  @if (batch()?.role === 'cook') {
                    <p class="flex gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-sm text-accent">
                      <app-icon name="pot" [size]="20" class="mt-0.5" />
                      <span>Cuisine double : les quantités couvrent ce soir <strong>et</strong> {{ partnerLabel() }}.</span>
                    </p>
                  } @else if (batch()?.role === 'leftover') {
                    <p class="flex gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-sm text-accent">
                      <app-icon name="check" [size]="20" class="mt-0.5" />
                      <span>Ce repas a été cuisiné {{ partnerLabel() }} : il ne reste qu'à réchauffer et assembler.</span>
                    </p>
                  }
                  <ul class="card divide !py-1">
                    @for (ingredient of r.ingredients; track ingredient.foodId) {
                      <li>
                        <button type="button" class="flex w-full items-center gap-3 py-3.5 text-left" [attr.aria-pressed]="checked().has(ingredient.foodId)" (click)="check(ingredient.foodId)">
                          <span class="grid size-7 shrink-0 place-items-center rounded-full" [class]="checked().has(ingredient.foodId) ? 'bg-accent text-on-accent' : 'bg-raised text-transparent'">
                            <app-icon name="check" [size]="16" [stroke]="2.6" />
                          </span>
                          <span class="text-[1.0625rem] leading-snug" [class]="checked().has(ingredient.foodId) ? 'text-faint line-through' : ''">{{ ingredient.label }}</span>
                        </button>
                      </li>
                    }
                  </ul>
                </section>
              }
              @case ('step') {
                <section class="fade-in space-y-6">
                  <p class="eyebrow">Étape {{ stepNumber() }} sur {{ r.steps.length }}</p>
                  <p class="text-[1.625rem] leading-snug font-semibold tracking-tight">{{ s.text }}</p>
                  @if (s.timer; as timer) {
                    <div class="card space-y-4 text-center">
                      <p class="eyebrow"><app-icon name="clock" [size]="14" class="mr-1 align-[-2px]" /> Minuteur · {{ timer.label }}</p>
                      <p class="num text-6xl font-bold tracking-tight" [class]="current()?.done ? 'text-accent' : ''" role="timer">
                        {{ current()?.done ? 'Terminé' : currentClock() }}
                      </p>
                      <div class="flex justify-center gap-2">
                        @if (current()?.done) {
                          <button type="button" class="btn btn-dark" (click)="start()"><app-icon name="refresh" [size]="18" /> Relancer</button>
                          <button type="button" class="btn" (click)="extend()">+ 1 min</button>
                        } @else if (current()?.endsAt) {
                          <button type="button" class="btn btn-dark" (click)="pause()">Pause</button>
                          <button type="button" class="btn" (click)="extend()">+ 1 min</button>
                        } @else {
                          <button type="button" class="btn btn-primary" (click)="start()">
                            <app-icon name="play" [size]="18" />
                            {{ current() ? 'Reprendre' : 'Lancer le minuteur' }}
                          </button>
                          @if (current()) {
                            <button type="button" class="btn" (click)="resetTimer()">Remettre à zéro</button>
                          }
                        }
                      </div>
                    </div>
                  }
                </section>
              }
              @case ('aside') {
                <section class="fade-in space-y-4">
                  <div>
                    <p class="eyebrow">Avant de te servir</p>
                    <h1 class="title mt-1">Mets de côté la portion de {{ partnerLabel() }}</h1>
                    <p class="mt-2 text-muted">Dans une boîte hermétique, au réfrigérateur une fois refroidie. Le reste est pour ce soir.</p>
                  </div>
                  <ul class="card divide !py-1">
                    @for (line of aside(); track line.name) {
                      <li class="row py-3.5">
                        <span class="text-[1.0625rem]">{{ line.name }}</span>
                        <span class="num font-semibold">{{ line.amount }}</span>
                      </li>
                    }
                  </ul>
                </section>
              }
              @case ('done') {
                <section class="fade-in space-y-5 text-center">
                  <div class="mx-auto grid size-16 place-items-center rounded-full bg-accent-soft text-accent"><app-icon name="utensils" [size]="30" /></div>
                  <div>
                    <h1 class="title">Bon appétit</h1>
                    <p class="num mt-2 text-muted">
                      {{ meal()!.nutrition.kcal | num }} kcal · <span class="font-semibold text-protein">{{ meal()!.nutrition.protein | num }} g</span> de protéines
                    </p>
                  </div>
                  @if (meal()!.status === 'planned') {
                    <button type="button" class="btn btn-primary btn-lg" [disabled]="store.busy()" (click)="eaten()">
                      <app-icon name="check" [stroke]="2.4" />
                      J'ai mangé ce repas
                    </button>
                  } @else {
                    <p class="badge badge-ok mx-auto">Repas déjà déclaré</p>
                  }
                  <button type="button" class="btn btn-lg bg-card" (click)="close()">Terminer sans déclarer</button>
                </section>
              }
            }
          }
        </main>

        @if (step()?.kind !== 'done') {
          <footer class="flex gap-3">
            @if (index() > 0) {
              <button type="button" class="btn btn-lg !w-auto bg-card px-6" (click)="previous()" aria-label="Étape précédente"><app-icon name="chevron-left" /></button>
            }
            <button type="button" class="btn btn-primary btn-lg flex-1" (click)="next()">
              {{ index() === 0 ? 'Commencer' : 'Étape suivante' }}
              <app-icon name="chevron-right" />
            </button>
          </footer>
        } @else {
          <footer>
            <button type="button" class="mx-auto flex items-center gap-1 text-sm font-semibold text-accent" (click)="previous()"><app-icon name="chevron-left" [size]="16" /> Revoir les étapes</button>
          </footer>
        }
      } @else {
        <main class="flex flex-1 flex-col items-center justify-center text-center">
          <p class="font-semibold">Ce repas n'est plus dans ton programme.</p>
          <p class="mt-1 text-sm text-muted">Il a peut-être été remplacé depuis.</p>
          <a routerLink="/programme" class="btn btn-dark mt-5">Retour au programme</a>
        </main>
      }
    </div>
  `,
})
export class CookPage {
  protected readonly store = inject(Store);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** `/programme/cuisine?plan=…&day=2&pos=1` */
  readonly plan = input<string>();
  readonly day = input(0, { transform: (v: unknown) => numberAttribute(v, 0) });
  readonly pos = input(0, { transform: (v: unknown) => numberAttribute(v, 0) });

  protected readonly index = signal(0);
  protected readonly checked = signal<ReadonlySet<string>>(new Set());
  protected readonly awake = signal(false);
  private readonly timers = signal<Record<number, TimerState>>({});
  private readonly now = signal(Date.now());

  private lock: WakeLockSentinel | null = null;
  private audio: AudioContext | null = null;

  private readonly weekPlan = computed(() => [this.store.currentPlan(), this.store.nextPlan()].find((p) => p?.id === this.plan()) ?? null);
  private readonly planDay = computed(() => this.weekPlan()?.days[this.day()] ?? null);
  protected readonly meal = computed(() => this.planDay()?.meals[this.pos()] ?? null);
  protected readonly slotLabel = computed(() => {
    const m = this.meal();
    return m ? `${SLOT_LABELS[m.slot]} · ${DAY_LABELS[this.day()]}` : '';
  });

  protected readonly batch = computed(() => {
    const m = this.meal();
    return m ? batchInfo(this.weekPlan(), m.id) : null;
  });
  protected readonly partnerLabel = computed(() => {
    const b = this.batch();
    if (!b) return '';
    return b.role === 'cook' ? `${DAY_LABELS[b.partnerDay]!.toLowerCase()} midi` : `${DAY_LABELS[b.partnerDay]!.toLowerCase()} soir`;
  });

  protected readonly recipe = computed(() => {
    const m = this.meal();
    const foods = this.store.foods();
    if (!m || foods.size === 0) return null;
    const b = this.batch();
    try {
      // En cuisine double, on prépare les deux portions d'un coup : les étapes affichent le total.
      return buildRecipe(b?.role === 'cook' ? combinedForCooking(m, b.partner) : m, this.store.templates().find((t) => t.id === m.templateId), foods, {
        level: this.weekPlan()?.level ?? 'normal',
        equipment: this.store.user()?.preferences.equipment ?? [],
      });
    } catch {
      return null;
    }
  });

  /** La portion du lendemain, en poids cuit quand il est connu. */
  protected readonly aside = computed(() => {
    const b = this.batch();
    if (b?.role !== 'cook') return [];
    const foods = this.store.foods();
    return cookedItems(b.partner.items).flatMap((item) => {
      const food = foods.get(item.foodId);
      if (!food) return [];
      const cooked = cookedGrams(food, item.grams);
      const amount = food.piece ? ingredientLabel(food, item.grams, true) : cooked ? `${formatGrams(cooked)} cuit` : formatGrams(item.grams, food.unit);
      return [{ name: food.name, amount }];
    });
  });

  protected readonly steps = computed<CookStep[]>(() => {
    const r = this.recipe();
    if (!r) return [];
    const list: CookStep[] = [{ kind: 'ingredients', text: '', timer: null }];
    const cooking: CookStep[] = r.steps.map((text) => ({ kind: 'step', text, timer: parseTimer(text) }));
    if (this.aside().length > 0) {
      // Avant le laitage et le fruit, qui ne se cuisinent pas.
      const dessert = cooking.findIndex((s) => /^(dessert|fruit|terminer par)/i.test(s.text));
      cooking.splice(dessert >= 0 ? dessert : cooking.length, 0, { kind: 'aside', text: '', timer: null });
    }
    return [...list, ...cooking, { kind: 'done', text: '', timer: null }];
  });

  protected readonly step = computed<CookStep | null>(() => this.steps()[Math.min(this.index(), this.steps().length - 1)] ?? null);
  /** Numéro de l'étape de recette affichée (les écrans intercalés ne comptent pas). */
  protected readonly stepNumber = computed(() => this.numberOf(this.index()));

  protected readonly current = computed<TimerState | null>(() => this.timers()[this.index()] ?? null);
  protected readonly currentClock = computed(() => {
    const timer = this.current();
    const fallback = this.step()?.timer?.seconds ?? 0;
    return clock(timer ? this.leftOf(timer) : fallback);
  });

  /** Minuteurs des autres étapes : le riz continue de cuire pendant qu'on saisit la viande. */
  protected readonly others = computed(() =>
    Object.entries(this.timers())
      .map(([key, timer]) => ({ step: Number(key), timer }))
      .filter(({ step, timer }) => step !== this.index() && (timer.endsAt !== null || timer.done))
      .map(({ step, timer }) => ({ step, number: this.numberOf(step), done: timer.done, clock: clock(this.leftOf(timer)) })),
  );

  constructor() {
    const tick = setInterval(() => this.tick(), 250);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void this.keepAwake();
    };
    document.addEventListener('visibilitychange', onVisible);
    void this.keepAwake();

    inject(DestroyRef).onDestroy(() => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      void this.lock?.release().catch(() => undefined);
      void this.audio?.close().catch(() => undefined);
    });
  }

  private numberOf(index: number): number {
    return this.steps()
      .slice(0, index + 1)
      .filter((s) => s.kind === 'step').length;
  }

  private leftOf(timer: TimerState): number {
    return timer.endsAt === null ? timer.left : Math.max(0, (timer.endsAt - this.now()) / 1000);
  }

  // ───────────── Écran allumé ─────────────

  /** Le verrou est relâché par le navigateur dès que l'onglet passe en arrière-plan : on le redemande au retour. */
  private async keepAwake(): Promise<void> {
    if (!('wakeLock' in navigator)) return;
    try {
      this.lock = await navigator.wakeLock.request('screen');
      this.awake.set(true);
      this.lock.addEventListener('release', () => this.awake.set(false));
    } catch {
      this.awake.set(false);
    }
  }

  // ───────────── Navigation ─────────────

  protected next(): void {
    if (this.index() < this.steps().length - 1) this.index.update((i) => i + 1);
  }

  protected previous(): void {
    if (this.index() > 0) this.index.update((i) => i - 1);
  }

  protected check(foodId: string): void {
    this.checked.update((set) => {
      const next = new Set(set);
      if (!next.delete(foodId)) next.add(foodId);
      return next;
    });
  }

  protected close(): void {
    // Arrivé par un lien direct (raccourci, rechargement) : il n'y a pas d'écran précédent.
    if (history.length > 1) this.location.back();
    else void this.router.navigateByUrl('/programme');
  }

  protected async eaten(): Promise<void> {
    const plan = this.weekPlan();
    const day = this.planDay();
    const meal = this.meal();
    if (!plan || !day || !meal) return;
    if (await this.store.logMeal(plan.id, meal, day.date, 'eaten')) {
      this.toasts.success('Repas enregistré.');
      void this.router.navigateByUrl('/');
    }
  }

  // ───────────── Minuteurs ─────────────

  private setTimer(index: number, timer: TimerState | null): void {
    this.timers.update((all) => {
      const next = { ...all };
      if (timer) next[index] = timer;
      else delete next[index];
      return next;
    });
  }

  protected start(): void {
    const seconds = this.step()?.timer?.seconds;
    if (!seconds) return;
    // Le son n'est autorisé qu'après un geste de l'utilisateur : on prépare la sortie audio ici.
    try {
      this.audio ??= new AudioContext();
      void this.audio.resume();
    } catch {
      /* pas de son disponible : la vibration et l'affichage suffisent */
    }
    const existing = this.current();
    const left = existing && !existing.done ? existing.left : seconds;
    this.now.set(Date.now());
    this.setTimer(this.index(), { total: seconds, left, endsAt: Date.now() + left * 1000, done: false });
  }

  protected pause(): void {
    const timer = this.current();
    if (!timer?.endsAt) return;
    this.setTimer(this.index(), { ...timer, left: this.leftOf(timer), endsAt: null });
  }

  protected extend(): void {
    const timer = this.current();
    if (!timer) return;
    this.now.set(Date.now());
    const left = (timer.done ? 0 : this.leftOf(timer)) + 60;
    this.setTimer(this.index(), { ...timer, left, endsAt: timer.endsAt !== null || timer.done ? Date.now() + left * 1000 : null, done: false });
  }

  protected resetTimer(): void {
    this.setTimer(this.index(), null);
  }

  private tick(): void {
    const running = Object.entries(this.timers()).filter(([, t]) => t.endsAt !== null);
    if (running.length === 0) return;
    const now = Date.now();
    this.now.set(now);
    for (const [key, timer] of running) {
      if (timer.endsAt! > now) continue;
      const index = Number(key);
      this.setTimer(index, { ...timer, left: 0, endsAt: null, done: true });
      this.alarm(index);
    }
  }

  private alarm(index: number): void {
    this.toasts.success(`Minuteur terminé — étape ${this.numberOf(index)}.`);
    try {
      navigator.vibrate?.([300, 150, 300, 150, 600]);
    } catch {
      /* vibration indisponible */
    }
    const audio = this.audio;
    if (!audio) return;
    try {
      for (const offset of [0, 0.35, 0.7]) {
        const at = audio.currentTime + offset;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.3);
      }
    } catch {
      /* son indisponible */
    }
  }
}
