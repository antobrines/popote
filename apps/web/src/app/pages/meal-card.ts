import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { type Meal, SLOT_LABELS, formatGrams } from '@bouffe/core';
import { Store } from '../core/store';
import { Icon, NumPipe } from '../ui/ui';
import { STATUS_LABELS, statusBadge } from './meal-sheet';

/** Distance de glissement (px) à partir de laquelle le geste est validé. */
const SWIPE_THRESHOLD = 84;

/**
 * Carte d'un repas : nom, quantités principales, calories, état.
 * Gestes rapides : glisser vers la droite pour « mangé », vers la gauche pour « remplacer ».
 * Les mêmes actions restent disponibles au toucher (bouton ✓, détail du repas).
 */
@Component({
  selector: 'app-meal-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, NumPipe],
  host: { class: 'block' },
  template: `
    <div class="relative overflow-hidden rounded-[1.5rem]">
      @if (dx() !== 0) {
        <div class="absolute inset-0 flex items-center justify-between px-6 font-semibold" [class]="dx() > 0 ? 'bg-accent text-on-accent' : 'bg-fg text-bg'" aria-hidden="true">
          <span class="flex items-center gap-2" [class.opacity-0]="dx() < 0">
            <app-icon name="check" [stroke]="2.4" />
            {{ meal().status === 'planned' ? 'Mangé' : 'Annuler' }}
          </span>
          <span class="flex items-center gap-2" [class.opacity-0]="dx() > 0">
            Remplacer
            <app-icon name="refresh" />
          </span>
        </div>
      }
      <article
        class="card relative flex touch-pan-y items-stretch gap-3 !p-0 select-none"
        [style.transform]="'translateX(' + dx() + 'px)'"
        [style.transition]="dragging() ? 'none' : 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)'"
        (pointerdown)="onDown($event)"
        (pointermove)="onMove($event)"
        (pointerup)="onUp()"
        (pointercancel)="reset()"
      >
        <button type="button" class="min-w-0 flex-1 rounded-[inherit] p-5 text-left" (click)="open()">
          <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span class="eyebrow">{{ slotLabels[meal().slot] }}</span>
            @if (meal().status !== 'planned') {
              <span [class]="badge(meal().status)">{{ meal().free ? 'Repas libre' : statusLabels[meal().status] }}</span>
            }
            @if (meal().context === 'away') {
              <span class="badge badge-info"><app-icon name="bag" [size]="11" /> À emporter</span>
            }
            @if (batch() === 'cook') {
              <span class="badge badge-ok"><app-icon name="pot" [size]="11" /> Cuisine double</span>
            } @else if (batch() === 'leftover') {
              <span class="badge badge-ok">Déjà cuisiné hier</span>
            }
            @if (meal().locked) {
              <span class="badge"><app-icon name="lock" [size]="11" /> Gardé</span>
            }
          </div>
          <h3 class="text-[1.0625rem] leading-snug font-semibold" [class.text-muted]="meal().status === 'skipped' || !!meal().free">
            {{ meal().free ? meal().free!.label : meal().name }}
          </h3>
          @if (meal().free; as free) {
            <p class="num mt-2.5 text-sm">
              <span class="font-semibold">≈ {{ free.kcal | num }} kcal</span>
              <span class="text-muted"> estimées · prévu : {{ meal().name }}</span>
            </p>
          } @else {
            @if (detailed()) {
              <ul class="mt-2 space-y-0.5 text-sm text-muted">
                @for (line of lines(); track line) {
                  <li>{{ line }}</li>
                }
              </ul>
            } @else {
              <p class="mt-1 truncate text-sm text-muted">{{ lines().slice(0, 3).join(' · ') }}</p>
            }
            <p class="num mt-2.5 text-sm">
              <span class="font-semibold">{{ meal().nutrition.kcal | num }} kcal</span>
              <span class="text-muted"> · </span>
              <span class="font-semibold text-protein">{{ meal().nutrition.protein | num }} g</span>
              <span class="text-muted"> protéines</span>
            </p>
          }
        </button>
        @if (quick()) {
          <div class="flex items-center pr-4">
            <button
              type="button"
              class="grid size-12 place-items-center rounded-full transition-colors"
              [class]="meal().status === 'eaten' ? 'bg-accent text-on-accent' : 'bg-raised text-faint'"
              (click)="toggled.emit()"
              [attr.aria-label]="meal().status === 'eaten' ? 'Annuler : repas mangé' : 'Marquer comme mangé'"
              [attr.aria-pressed]="meal().status === 'eaten'"
            >
              <app-icon name="check" [size]="24" [stroke]="2.4" />
            </button>
          </div>
        }
      </article>
    </div>
  `,
})
export class MealCard {
  private readonly store = inject(Store);

  readonly meal = input.required<Meal>();
  /** Affiche chaque ingrédient sur sa ligne (vue Programme). */
  readonly detailed = input(false);
  /** Affiche le bouton de validation rapide. */
  readonly quick = input(true);
  /** Rôle dans « cuisiner une fois, manger deux fois ». */
  readonly batch = input<'cook' | 'leftover' | null>(null);
  readonly opened = output<void>();
  readonly toggled = output<void>();
  /** Glissé vers la gauche : demander un autre repas. */
  readonly swapped = output<void>();

  protected readonly slotLabels = SLOT_LABELS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly badge = statusBadge;
  protected readonly dx = signal(0);
  protected readonly dragging = signal(false);

  private start: { x: number; y: number } | null = null;
  private horizontal = false;
  private moved = false;

  protected readonly lines = computed(() => {
    const foods = this.store.foods();
    return this.meal().items.map((item) => {
      const food = foods.get(item.foodId);
      if (!food) return item.foodId;
      if (food.piece) {
        const count = Math.round((item.grams / food.piece.grams) * 10) / 10;
        return `${count.toLocaleString('fr-FR')} ${count > 1 ? food.piece.plural : food.piece.label}`;
      }
      return `${formatGrams(item.grams, food.unit)} ${food.shortName}`;
    });
  });

  protected open(): void {
    // Le clic qui termine un glissement ne doit pas ouvrir le détail.
    if (this.moved) {
      this.moved = false;
      return;
    }
    this.opened.emit();
  }

  protected onDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.start = { x: event.clientX, y: event.clientY };
    this.horizontal = false;
    this.moved = false;
  }

  protected onMove(event: PointerEvent): void {
    if (!this.start) return;
    const dx = event.clientX - this.start.x;
    const dy = event.clientY - this.start.y;
    if (!this.horizontal) {
      // On laisse le défilement vertical tranquille : le geste ne démarre que s'il est franchement horizontal.
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) return this.reset();
      if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      this.horizontal = true;
      this.dragging.set(true);
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    }
    this.moved = true;
    // Remplacer n'a de sens que pour un repas encore prévu.
    const min = this.meal().status === 'planned' ? -140 : 0;
    this.dx.set(Math.max(min, Math.min(140, dx)));
  }

  protected onUp(): void {
    const dx = this.dx();
    if (dx >= SWIPE_THRESHOLD) this.toggled.emit();
    else if (dx <= -SWIPE_THRESHOLD) this.swapped.emit();
    this.reset(true);
    // Le clic de fin de geste arrive (ou non) juste après : passé ce délai, un toucher redevient un toucher.
    setTimeout(() => (this.moved = false), 80);
  }

  protected reset(keepMoved = false): void {
    this.start = null;
    this.horizontal = false;
    this.dragging.set(false);
    this.dx.set(0);
    if (!keepMoved) this.moved = false;
  }
}
