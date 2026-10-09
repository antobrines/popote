import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { diffDays } from '@bouffe/core';
import { Store } from '../core/store';
import { Toasts } from '../core/toasts';
import { Bar, DayPipe, Icon, NumPipe } from '../ui/ui';

const W = 320;
const H = 150;
const PAD = { top: 12, right: 12, bottom: 22, left: 34 };

@Component({
  selector: 'app-progress-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon, Bar, NumPipe, DayPipe],
  template: `
    <div class="page space-y-6">
      <header>
        <h1 class="title">Progression</h1>
      </header>

      @if (!consent()) {
        <section class="card space-y-3">
          <h2 class="text-lg font-bold">Suivre mon poids et mon activité</h2>
          <p class="text-sm leading-relaxed text-muted">
            Ce sont des données de santé : elles ne sont enregistrées qu'avec ton accord explicite, servent uniquement à ton suivi, et tu peux les exporter ou les effacer à tout
            moment depuis ton profil.
          </p>
          <button type="button" class="btn btn-primary w-full" (click)="store.updateMe({ consentHealthData: true })">Activer le suivi</button>
        </section>
      } @else if (summary(); as s) {
        <section class="card space-y-5">
          <div class="grid grid-cols-3 text-center">
            <div>
              <p class="eyebrow">Départ</p>
              <p class="num mt-1 text-xl font-bold">{{ s.startKg | num: 1 }}</p>
            </div>
            <div>
              <p class="eyebrow">Actuel</p>
              <p class="num mt-1 text-3xl leading-none font-bold text-accent">{{ s.currentKg ?? s.startKg | num: 1 }}</p>
            </div>
            <div>
              <p class="eyebrow">Objectif</p>
              <p class="num mt-1 text-xl font-bold">{{ s.goalKg | num: 1 }}</p>
            </div>
          </div>
          <div>
            <app-bar [value]="s.progressPct" [max]="100" />
            <div class="num row mt-2 text-sm">
              <span><span class="font-semibold">{{ s.lostKg | num: 1 }} kg</span> <span class="text-muted">{{ s.lostKg >= 0 ? 'perdus' : 'pris' }}</span></span>
              <span><span class="font-semibold">{{ s.remainingKg | num: 1 }} kg</span> <span class="text-muted">restants</span></span>
            </div>
          </div>
          @if (s.weeklyRateKg !== null) {
            <p class="num border-t border-line pt-3 text-center text-sm text-muted">
              Tendance : <span class="font-semibold text-fg">{{ s.weeklyRateKg > 0 ? '+' : '' }}{{ s.weeklyRateKg | num: 2 }} kg / semaine</span> (moyenne mobile, 4 semaines)
            </p>
          }
        </section>

        <form class="card flex items-end gap-3" (ngSubmit)="saveWeight()">
          <div class="flex-1">
            <label class="label" for="w-date">Date</label>
            <input id="w-date" class="input num" type="date" name="date" [max]="store.today()" [(ngModel)]="weightDate" />
          </div>
          <div class="w-28">
            <label class="label" for="w-kg">Poids (kg)</label>
            <input id="w-kg" class="input num text-center text-lg font-semibold" type="number" name="kg" inputmode="decimal" step="0.1" min="20" max="400" [(ngModel)]="weightKg" />
          </div>
          <button type="submit" class="btn btn-dark" [disabled]="!weightKg">Peser</button>
        </form>

        <section class="card">
          <div class="row mb-3">
            <h2 class="eyebrow">Évolution</h2>
            <p class="flex items-center gap-3 text-xs text-muted">
              <span class="flex items-center gap-1"><span class="inline-block size-2 rounded-full bg-faint"></span> pesées</span>
              <span class="flex items-center gap-1"><span class="inline-block h-0.5 w-4 rounded bg-accent"></span> moyenne 7 j</span>
            </p>
          </div>
          @if (chart(); as c) {
            <svg [attr.viewBox]="'0 0 ' + width + ' ' + height" class="w-full" role="img" [attr.aria-label]="'Courbe de poids : de ' + c.first + ' à ' + c.last + ' kilogrammes'">
              @for (tick of c.ticks; track tick.label) {
                <line [attr.x1]="pad.left" [attr.x2]="width - pad.right" [attr.y1]="tick.y" [attr.y2]="tick.y" stroke="var(--line)" stroke-width="1" />
                <text [attr.x]="pad.left - 6" [attr.y]="tick.y + 3.5" text-anchor="end" font-size="10" fill="var(--muted)">{{ tick.label }}</text>
              }
              @if (c.average.length > 1) {
                <polyline [attr.points]="c.averagePath" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
              }
              @for (p of c.points; track p.date) {
                <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3" fill="var(--card)" stroke="var(--faint)" stroke-width="1.5">
                  <title>{{ p.date | day }} : {{ p.kg | num: 1 }} kg</title>
                </circle>
              }
              <text [attr.x]="pad.left" [attr.y]="height - 5" font-size="10" fill="var(--muted)">{{ c.from | day }}</text>
              <text [attr.x]="width - pad.right" [attr.y]="height - 5" text-anchor="end" font-size="10" fill="var(--muted)">{{ c.to | day }}</text>
            </svg>
          } @else {
            <p class="py-8 text-center text-sm text-muted">Ajoute une pesée pour démarrer ta courbe.</p>
          }
          <p class="mt-3 text-xs leading-relaxed text-muted">Le poids varie de 1 à 2 kg d'un jour à l'autre (eau, sel, digestion) : seule la moyenne compte.</p>
        </section>

        @if (suggestion(); as sg) {
          <section class="card space-y-3" [class]="sg.kind === 'none' ? '' : 'ring-2 ring-protein'">
            <h2 class="eyebrow">Budget calorique · {{ sg.currentKcal | num }} kcal</h2>
            <p class="text-sm leading-relaxed">{{ sg.reason }}</p>
            @if (sg.advice) {
              <p class="text-sm leading-relaxed text-muted">{{ sg.advice }}</p>
            }
            @if (sg.kind !== 'none') {
              <div class="flex gap-2 pt-1">
                <button type="button" class="btn btn-primary flex-1" [disabled]="store.busy()" (click)="applySuggestion(sg.suggestedKcal)">Passer à {{ sg.suggestedKcal | num }} kcal</button>
                <button type="button" class="btn flex-1" (click)="dismissed.set(true)">Garder {{ sg.currentKcal | num }}</button>
              </div>
              <p class="text-xs text-muted">Rien ne change sans ta confirmation. Plancher pour ton profil : {{ sg.floorKcal | num }} kcal.</p>
            }
          </section>
        }

        @if (s.weekly.length > 0) {
          <section>
            <h2 class="eyebrow mb-2">Semaine par semaine</h2>
            <ul class="card divide !py-1">
              @for (week of weeks(); track week.weekStart) {
                <li class="num row py-3 text-sm">
                  <span class="text-muted">Semaine du {{ week.weekStart | day }}</span>
                  <span>
                    <span class="font-semibold">{{ week.avgKg | num: 1 }} kg</span>
                    @if (week.deltaKg !== null) {
                      <span class="ml-2" [class]="week.deltaKg <= 0 ? 'text-accent' : 'text-warn'">{{ week.deltaKg > 0 ? '+' : '' }}{{ week.deltaKg | num: 1 }}</span>
                    }
                  </span>
                </li>
              }
            </ul>
          </section>
        }

        <section class="card space-y-4">
          <h2 class="eyebrow">Activité d'aujourd'hui</h2>
          <form class="space-y-3" (ngSubmit)="saveActivity()">
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="label" for="a-steps">Pas</label>
                <input id="a-steps" class="input num" type="number" name="steps" inputmode="numeric" min="0" [(ngModel)]="activity.steps" />
              </div>
              <div>
                <label class="label" for="a-kcal">Kcal actives</label>
                <input id="a-kcal" class="input num" type="number" name="kcal" inputmode="numeric" min="0" [(ngModel)]="activity.activeKcal" />
              </div>
              <div>
                <label class="label" for="a-sleep">Sommeil (h)</label>
                <input id="a-sleep" class="input num" type="number" name="sleep" inputmode="decimal" min="0" max="24" step="0.25" [(ngModel)]="activity.sleepHours" />
              </div>
            </div>
            <div class="grid grid-cols-[1fr_6rem] gap-3">
              <div>
                <label class="label" for="a-workout">Entraînement</label>
                <input id="a-workout" class="input" name="workout" maxlength="60" placeholder="Musculation, marche…" [(ngModel)]="activity.workout" />
              </div>
              <div>
                <label class="label" for="a-min">Minutes</label>
                <input id="a-min" class="input num" type="number" name="minutes" inputmode="numeric" min="1" [(ngModel)]="activity.minutes" />
              </div>
            </div>
            <button type="submit" class="btn w-full">Enregistrer l'activité</button>
          </form>
          @if (todayActivity(); as a) {
            <p class="num border-t border-line pt-3 text-sm text-muted">
              Enregistré : {{ a.steps ?? 0 | num }} pas · {{ a.activeKcal ?? 0 | num }} kcal actives
              @if (a.sleepMinutes) {
                · {{ a.sleepMinutes / 60 | num: 1 }} h de sommeil
              }
              @for (w of a.workouts; track $index) {
                · {{ w.kind }} {{ w.minutes }} min
              }
            </p>
          }
        </section>

        @for (provider of healthProviders(); track provider.id) {
          <section class="card space-y-2">
            <div class="row">
              <h2 class="font-semibold">{{ provider.label }}</h2>
              <span class="badge badge-warn">Non disponible</span>
            </div>
            <p class="text-sm leading-relaxed text-muted">{{ provider.explanation }}</p>
            @if (provider.roadmap) {
              <ol class="list-decimal space-y-1 pl-5 text-sm text-muted">
                @for (step of provider.roadmap; track step) {
                  <li>{{ step }}</li>
                }
              </ol>
            }
          </section>
        }

        @if (recent().length > 0) {
          <section>
            <h2 class="eyebrow mb-2">Dernières pesées</h2>
            <ul class="card divide !py-1">
              @for (w of recent(); track w.date) {
                <li class="num row py-2.5 text-sm">
                  <span class="inline-block text-muted first-letter:uppercase">{{ w.date | day }}</span>
                  <span class="flex items-center gap-3">
                    <span class="font-semibold">{{ w.kg | num: 1 }} kg</span>
                    <button type="button" class="grid size-8 place-items-center rounded-full bg-raised text-muted" (click)="store.deleteWeight(w.date)" [attr.aria-label]="'Supprimer la pesée du ' + w.date">
                      <app-icon name="trash" [size]="14" />
                    </button>
                  </span>
                </li>
              }
            </ul>
          </section>
        }
      }
    </div>
  `,
})
export class ProgressPage {
  protected readonly store = inject(Store);
  private readonly toasts = inject(Toasts);

  protected readonly width = W;
  protected readonly height = H;
  protected readonly pad = PAD;
  protected readonly dismissed = signal(false);
  protected weightDate = this.store.today();
  protected weightKg: number | null = null;
  protected activity: { steps: number | null; activeKcal: number | null; sleepHours: number | null; workout: string; minutes: number | null } = {
    steps: null,
    activeKcal: null,
    sleepHours: null,
    workout: '',
    minutes: null,
  };

  protected readonly consent = computed(() => !!this.store.user()?.consents.healthData);
  protected readonly summary = computed(() => this.store.state()?.weightSummary ?? null);
  protected readonly weeks = computed(() => [...(this.summary()?.weekly ?? [])].reverse().slice(0, 8));
  protected readonly recent = computed(() => [...(this.store.state()?.weights ?? [])].reverse().slice(0, 8));
  protected readonly todayActivity = computed(() => this.store.state()?.activities.find((a) => a.date === this.store.today() && a.source === 'manual') ?? null);
  protected readonly healthProviders = computed(() => (this.store.state()?.integrations.health ?? []).filter((p) => !p.available));
  protected readonly suggestion = computed(() => {
    const s = this.store.state()?.calorieSuggestion ?? null;
    return s && this.dismissed() ? { ...s, kind: 'none' as const, reason: 'Suggestion ignorée pour le moment. Elle sera réévaluée avec tes prochaines pesées.', advice: undefined } : s;
  });

  /** Courbe : pesées brutes (points) et moyenne mobile sur 7 jours (ligne). */
  protected readonly chart = computed(() => {
    const weights = this.store.state()?.weights ?? [];
    const average = this.summary()?.movingAverage ?? [];
    if (weights.length === 0) return null;
    const from = weights[0]!.date;
    const to = weights[weights.length - 1]!.date;
    const span = Math.max(1, diffDays(from, to));
    const values = [...weights.map((w) => w.kg), ...average.map((a) => a.kg)];
    const min = Math.floor(Math.min(...values) - 0.5);
    const max = Math.ceil(Math.max(...values) + 0.5);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (date: string) => (weights.length === 1 ? PAD.left + innerW / 2 : PAD.left + (diffDays(from, date) / span) * innerW);
    const y = (kg: number) => PAD.top + (1 - (kg - min) / Math.max(1, max - min)) * innerH;
    const tickCount = 3;
    return {
      from,
      to,
      first: weights[0]!.kg,
      last: weights[weights.length - 1]!.kg,
      points: weights.map((w) => ({ date: w.date, kg: w.kg, x: x(w.date), y: y(w.kg) })),
      average,
      averagePath: average.map((a) => `${x(a.date).toFixed(1)},${y(a.kg).toFixed(1)}`).join(' '),
      ticks: Array.from({ length: tickCount + 1 }, (_, i) => {
        const kg = min + ((max - min) * i) / tickCount;
        return { y: y(kg), label: kg.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) };
      }),
    };
  });

  protected async saveWeight(): Promise<void> {
    if (!this.weightKg) return;
    if (await this.store.setWeight(this.weightDate || this.store.today(), +this.weightKg)) {
      this.toasts.success('Pesée enregistrée.');
      this.weightKg = null;
    }
  }

  protected async applySuggestion(kcal: number): Promise<void> {
    const protein = this.store.goal()?.protein ?? 180;
    if (await this.store.setGoal(kcal, protein, 'suggestion')) {
      this.toasts.success(`Budget ajusté à ${kcal.toLocaleString('fr-FR')} kcal. Il s'appliquera à ta prochaine semaine générée.`);
    }
  }

  protected async saveActivity(): Promise<void> {
    const a = this.activity;
    const existing = this.todayActivity();
    const workouts = [...(existing?.workouts ?? [])];
    if (a.workout.trim() && a.minutes) workouts.push({ kind: a.workout.trim(), minutes: Math.round(+a.minutes) });
    const ok = await this.store.setActivity(this.store.today(), {
      steps: a.steps !== null && `${a.steps}` !== '' ? Math.round(+a.steps) : existing?.steps,
      activeKcal: a.activeKcal !== null && `${a.activeKcal}` !== '' ? Math.round(+a.activeKcal) : existing?.activeKcal,
      sleepMinutes: a.sleepHours !== null && `${a.sleepHours}` !== '' ? Math.round(+a.sleepHours * 60) : existing?.sleepMinutes,
      workouts,
    });
    if (ok) {
      this.toasts.success('Activité enregistrée.');
      this.activity = { steps: null, activeKcal: null, sleepHours: null, workout: '', minutes: null };
    }
  }
}
