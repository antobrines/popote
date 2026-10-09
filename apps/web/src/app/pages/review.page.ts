import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DAY_LABELS, SLOT_LABELS, type MealStatus, reviewWeek } from '@bouffe/core';
import { Store } from '../core/store';
import { Bar, DayPipe, EuroPipe, Icon, NumPipe, Ring } from '../ui/ui';
import { STATUS_LABELS, statusBadge } from './meal-sheet';

/** Bilan du dimanche : ce qui était prévu, ce qui a été fait, où ça mène — puis la semaine suivante. */
@Component({
  selector: 'app-review-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, Ring, Bar, NumPipe, DayPipe, EuroPipe],
  template: `
    <div class="page space-y-6">
      <header>
        <a routerLink="/" class="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-accent"><app-icon name="chevron-left" [size]="16" /> Aujourd'hui</a>
        <h1 class="title">Bilan</h1>
        @if (plan(); as p) {
          <p class="mt-2 text-muted">Semaine du {{ p.weekStart | day }}</p>
        }
      </header>

      @if (review(); as r) {
        <section class="card fade-in flex items-center gap-5" aria-label="Suivi du programme">
          <app-ring [value]="r.adherencePct ?? 0" [max]="100" [size]="116" [label]="(r.adherencePct ?? 0) + ' % des repas mangés comme prévu'">
            <div>
              <p class="num text-2xl leading-none font-bold">{{ r.adherencePct === null ? '—' : r.adherencePct + ' %' }}</p>
              <p class="mt-1 text-xs text-muted">suivi</p>
            </div>
          </app-ring>
          <div class="min-w-0 flex-1">
            <p class="text-lg leading-snug font-bold">{{ verdict() }}</p>
            @if (r.mealsDue > 0) {
              <p class="num mt-1 text-sm text-muted">{{ r.eaten }} repas sur {{ r.mealsDue }} mangés comme prévu.</p>
            }
          </div>
        </section>

        @if (r.mealsDue > 0) {
          <section class="grid grid-cols-4 gap-2 text-center" aria-label="Détail des repas">
            <div class="card !px-2 !py-3">
              <p class="num text-xl font-bold">{{ r.partial }}</p>
              <p class="text-xs text-muted">en partie</p>
            </div>
            <div class="card !px-2 !py-3">
              <p class="num text-xl font-bold">{{ r.replaced }}</p>
              <p class="text-xs text-muted">remplacés</p>
            </div>
            <div class="card !px-2 !py-3">
              <p class="num text-xl font-bold">{{ r.skipped }}</p>
              <p class="text-xs text-muted">sautés</p>
            </div>
            <div class="card !px-2 !py-3">
              <p class="num text-xl font-bold" [class.text-warn]="r.undeclared > 0">{{ r.undeclared }}</p>
              <p class="text-xs text-muted">non déclarés</p>
            </div>
          </section>
        }

        @if (deviations().length > 0) {
          <section>
            <h2 class="eyebrow mb-2">Ce qui n'a pas suivi le plan</h2>
            <ul class="card divide !py-1">
              @for (d of deviations(); track d.id) {
                <li class="row py-3">
                  <span class="min-w-0">
                    <span class="block truncate font-medium">{{ d.name }}</span>
                    <span class="text-sm text-muted">{{ d.when }}</span>
                  </span>
                  <span [class]="badge(d.status)">{{ d.label }}</span>
                </li>
              }
            </ul>
            @if (r.undeclared > 0) {
              <p class="mt-2 px-1 text-sm text-muted">
                {{ r.undeclared }} repas des jours passés sans déclaration : les moyennes ci-dessous ne comptent que les journées entièrement déclarées.
              </p>
            }
          </section>
        }

        <section class="card space-y-4" aria-label="Moyennes réelles">
          <div class="row">
            <h2 class="eyebrow">Ce que tu as réellement mangé</h2>
            <span class="num text-xs text-muted">{{ r.daysLogged }} jour{{ r.daysLogged > 1 ? 's' : '' }} complet{{ r.daysLogged > 1 ? 's' : '' }}</span>
          </div>
          @if (r.avgKcal !== null && r.avgProtein !== null) {
            <div>
              <div class="row mb-1.5 text-sm">
                <span class="text-muted">Calories par jour</span>
                <span class="num font-semibold">{{ r.avgKcal | num }} / {{ r.targetKcal | num }} kcal</span>
              </div>
              <app-bar [value]="r.avgKcal" [max]="r.targetKcal" />
            </div>
            <div>
              <div class="row mb-1.5 text-sm">
                <span class="text-muted">Protéines par jour</span>
                <span class="num font-semibold">{{ r.avgProtein | num }} / {{ r.targetProtein | num }} g</span>
              </div>
              <app-bar [value]="r.avgProtein" [max]="r.targetProtein" color="var(--protein)" />
            </div>
            <p class="num border-t border-line pt-3 text-sm text-muted">
              <span class="font-semibold text-fg">{{ r.daysOnTarget }} jour{{ r.daysOnTarget > 1 ? 's' : '' }} sur {{ r.daysLogged }}</span> dans la cible calorique.
            </p>
          } @else {
            <p class="text-sm text-muted">Aucune journée entièrement déclarée pour l'instant. Coche tes repas au fil de la semaine pour obtenir tes moyennes.</p>
          }
        </section>

        <a routerLink="/progression" class="card block space-y-3" aria-label="Poids">
          <div class="row">
            <h2 class="eyebrow">Poids</h2>
            <app-icon name="chevron-right" [size]="18" class="text-faint" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <p class="num text-2xl font-bold">{{ signed(r.weightDeltaKg) }}</p>
              <p class="text-xs text-muted">cette semaine (moyenne)</p>
            </div>
            <div>
              <p class="num text-2xl font-bold">{{ signed(r.weeklyRateKg) }}</p>
              <p class="text-xs text-muted">par semaine, en tendance</p>
            </div>
          </div>
          @if (r.goal; as goal) {
            <p class="border-t border-line pt-3 text-sm">
              À ce rythme, objectif atteint vers <span class="font-semibold">{{ goalMonth() }}</span>
              <span class="text-muted"> (≈ {{ goal.weeks }} semaines). Une estimation, pas une promesse : le rythme ralentit souvent en fin de parcours.</span>
            </p>
          } @else {
            <p class="border-t border-line pt-3 text-sm text-muted">{{ goalHint() }}</p>
          }
        </a>

        @if (r.plannedCost !== null || r.actualCost !== null) {
          <section class="card" aria-label="Budget">
            <h2 class="eyebrow mb-3">Courses</h2>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <p class="num text-2xl font-bold">{{ r.plannedCost | euro }}</p>
                <p class="text-xs text-muted">prévu</p>
              </div>
              <div>
                <p class="num text-2xl font-bold">{{ r.actualCost | euro }}</p>
                <p class="text-xs text-muted">{{ r.actualCost === null ? 'pas de ticket enregistré' : 'payé en magasin' }}</p>
              </div>
            </div>
          </section>
        }

        @if (suggestion(); as s) {
          <a routerLink="/progression" class="card flex items-start gap-3">
            <app-icon name="info" class="mt-0.5 text-protein" />
            <span class="text-sm">
              <span class="font-semibold">Ajustement suggéré : {{ s.suggestedKcal | num }} kcal</span>
              <span class="mt-0.5 block text-muted">{{ s.reason }} À confirmer dans Progression — rien n'est modifié sans ton accord.</span>
            </span>
          </a>
        }

        <section class="space-y-3">
          @if (store.nextPlan()) {
            <button type="button" class="btn btn-primary btn-lg" (click)="openNext(false)"><app-icon name="calendar" /> Voir la semaine prochaine</button>
            <button type="button" class="btn btn-lg bg-card" (click)="openNext(true)"><app-icon name="refresh" /> La régénérer</button>
          } @else {
            <button type="button" class="btn btn-primary btn-lg" (click)="openNext(true)"><app-icon name="sparkles" /> Générer ma semaine prochaine</button>
          }
        </section>
      } @else {
        <section class="card fade-in text-center">
          <div class="mx-auto grid size-14 place-items-center rounded-full bg-accent-soft text-accent"><app-icon name="flag" [size]="28" /></div>
          <h2 class="mt-4 text-xl font-bold">Pas de programme cette semaine</h2>
          <p class="mt-2 text-muted">Le bilan compare ce qui était prévu à ce que tu as mangé : il lui faut une semaine générée.</p>
          <a routerLink="/programme" [queryParams]="{ generer: 1 }" class="btn btn-primary btn-lg mt-5">Générer ma semaine</a>
        </section>
      }
    </div>
  `,
})
export class ReviewPage {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);

  protected readonly badge = statusBadge;
  protected readonly plan = this.store.currentPlan;

  protected readonly review = computed(() => {
    const plan = this.plan();
    const state = this.store.state();
    if (!plan || !state) return null;
    const list = state.shoppingLists.find((l) => l.weekStart === plan.weekStart);
    const purchases = state.purchases.filter((p) => p.weekStart === plan.weekStart);
    return reviewWeek({
      plan,
      entries: state.entries,
      today: this.store.today(),
      weightSummary: state.weightSummary,
      plannedCost: list?.totals.cost ?? null,
      actualCost: purchases.length ? Math.round(purchases.reduce((sum, p) => sum + p.actualTotal, 0) * 100) / 100 : null,
    });
  });

  protected readonly verdict = computed(() => {
    const pct = this.review()?.adherencePct ?? null;
    if (pct === null) return 'La semaine commence à peine.';
    if (pct >= 85) return 'Semaine tenue.';
    if (pct >= 60) return 'Semaine correcte, avec quelques écarts.';
    return 'Semaine compliquée. Ça arrive : on repart sur la suivante.';
  });

  /** Les repas échus qui n'ont pas été mangés comme prévu (hors non déclarés). */
  protected readonly deviations = computed(() => {
    const plan = this.plan();
    if (!plan) return [];
    const off: MealStatus[] = ['partial', 'replaced', 'skipped'];
    return plan.days
      .filter((d) => d.date <= this.store.today())
      .flatMap((d) =>
        d.meals
          .filter((m) => off.includes(m.status))
          .map((m) => ({
            id: m.id,
            name: m.free ? m.free.label : m.name,
            when: `${DAY_LABELS[d.index]} · ${SLOT_LABELS[m.slot].toLowerCase()}`,
            status: m.status,
            label: m.free ? 'Repas libre' : STATUS_LABELS[m.status],
          })),
      );
  });

  protected readonly suggestion = computed(() => {
    const s = this.store.state()?.calorieSuggestion;
    return s && s.kind !== 'none' ? s : null;
  });

  protected readonly goalMonth = computed(() => {
    const goal = this.review()?.goal;
    if (!goal) return '';
    const [y, m, d] = goal.date.split('-').map(Number);
    return new Date(y!, m! - 1, d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  });

  protected readonly goalHint = computed(() => {
    const summary = this.store.state()?.weightSummary;
    if (!summary || summary.trendKg === null || summary.weeklyRateKg === null) return 'Encore trop peu de pesées pour estimer une date : pèse-toi régulièrement, la tendance se dessine en deux à trois semaines.';
    if (summary.remainingKg <= 0) return 'Objectif atteint.';
    return 'La tendance actuelle ne permet pas d’estimer une date. Regarde le détail dans Progression.';
  });

  protected signed(kg: number | null): string {
    if (kg === null) return '—';
    return `${kg > 0 ? '+' : ''}${kg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg`;
  }

  protected openNext(generate: boolean): void {
    this.store.week.set('next');
    void this.router.navigate(['/programme'], generate ? { queryParams: { generer: 1 } } : {});
  }
}
