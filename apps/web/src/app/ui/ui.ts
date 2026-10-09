/** Petits composants d'interface réutilisables. */
import { ChangeDetectionStrategy, Component, Pipe, type PipeTransform, computed, input, output } from '@angular/core';
import { formatEuro, formatGrams } from '@bouffe/core';

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  calendar: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  cart: 'M3 4h2l2.4 11h10.2L20 7H6.2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  chart: 'M4 19V5M4 19h16M8 15l3-4 3 2 4-6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.500 8 5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 8v8M11 8v8M13.5 8v8M16 8v8',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.5L20 16M20 20v-4h-4',
  swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  star: 'M12 3.5l2.600 5.300 5.900.900-4.300 4.100 1 5.800L12 16.900l-5.200 2.700 1-5.800L3.500 9.700l5.900-.900z',
  heart: 'M12 20s-7-4.400-7-10a4 4 0 0 1 7-2.600A4 4 0 0 1 19 10c0 5.600-7 10-7 10z',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.700 5.700l12.600 12.600',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  share: 'M12 15V4M8 8l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6',
  printer: 'M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  tag: 'M4 4h7l9 9-7 7-9-9zM8 8h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  alert: 'M12 4l9 15H3zM12 10v4M12 17h.01',
  'wifi-off': 'M3 3l18 18M8.500 16.500a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4-2.500M19 13a10 10 0 0 0-5-2.700M12 20h.01',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600l1.400 1.400M17 17l1.400 1.400M5.600 18.400L7 17M17 7l1.400-1.400',
  moon: 'M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500z',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.500 6.500l4 4',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  bag: 'M6 8h12l1 12H5zM9 8V6a3 3 0 0 1 6 0v2',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  'arrow-up': 'M12 19V5M6 11l6-6 6 6',
  'arrow-down': 'M12 5v14M6 13l6 6 6-6',
  download: 'M12 4v11M8 11l4 4 4-4M5 20h14',
  logout: 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 16l4-4-4-4M14 12H4',
  sparkles: 'M12 4l1.800 4.700 4.700 1.800-4.700 1.800L12 17l-1.800-4.700-4.700-1.800 4.700-1.800zM19 16l.800 2.200L22 19l-2.200.800L19 22l-.800-2.200L16 19l2.200-.800z',
  flame: 'M12 21a6 6 0 0 0 6-6c0-3-2-5-3-7-1 2-2 2.500-3 2.500C12 8 12 5 10 3 9.500 6 6 9 6 15a6 6 0 0 0 6 6z',
  pot: 'M5 10h14v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM3 10h18M9 6c0-1 1-1 1-2M14 6c0-1 1-1 1-2',
  scale: 'M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 9a5.500 5.500 0 0 1 8 0l-2.500 2.500h-3z',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  store: 'M4 9l1.500-5h13L20 9M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M4 9h16M9 20v-6h6v6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  unlock: 'M7 11V8a5 5 0 0 1 9.500-2.200M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  play: 'M7 5l12 7-12 7z',
  dumbbell: 'M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
  utensils: 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-3 4.500-3 7.500h3V21',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  circle: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  half: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 4v16M12 8h5.500M12 12h7.500M12 16h5.500',
} as const;

export type IconName = keyof typeof ICONS;

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none" stroke="currentColor" [attr.stroke-width]="stroke()" stroke-linecap="round" stroke-linejoin="round">
      <path [attr.d]="path()" />
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(22);
  readonly stroke = input(1.8);
  protected readonly path = computed(() => ICONS[this.name()]);
}

/** Anneau de progression (calories, protéines). */
@Component({
  selector: 'app-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative inline-grid place-items-center', role: 'img', '[attr.aria-label]': 'label()' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" [attr.viewBox]="'0 0 ' + size() + ' ' + size()" class="-rotate-90">
      <circle [attr.cx]="size() / 2" [attr.cy]="size() / 2" [attr.r]="radius()" fill="none" stroke="var(--raised)" [attr.stroke-width]="thickness()" />
      <circle
        [attr.cx]="size() / 2"
        [attr.cy]="size() / 2"
        [attr.r]="radius()"
        fill="none"
        [attr.stroke]="over() ? 'var(--warn)' : color()"
        [attr.stroke-width]="thickness()"
        stroke-linecap="round"
        [attr.stroke-dasharray]="circumference()"
        [attr.stroke-dashoffset]="offset()"
        style="transition: stroke-dashoffset 0.6s cubic-bezier(0.22, 1, 0.36, 1)"
      />
    </svg>
    <div class="absolute inset-0 grid place-items-center text-center"><ng-content /></div>
  `,
})
export class Ring {
  readonly value = input(0);
  readonly max = input(1);
  readonly size = input(132);
  readonly thickness = input(12);
  readonly color = input('var(--accent)');
  /** Tolérance au-delà de la cible avant de passer en couleur d'alerte. */
  readonly tolerance = input(0);
  readonly label = input('');

  protected readonly radius = computed(() => (this.size() - this.thickness()) / 2);
  protected readonly circumference = computed(() => 2 * Math.PI * this.radius());
  protected readonly over = computed(() => this.tolerance() > 0 && this.value() > this.max() + this.tolerance());
  protected readonly offset = computed(() => {
    const ratio = this.max() > 0 ? Math.min(1, Math.max(0, this.value() / this.max())) : 0;
    return this.circumference() * (1 - ratio);
  });
}

@Component({
  selector: 'app-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-2 w-full overflow-hidden rounded-full bg-raised', role: 'progressbar', '[attr.aria-valuenow]': 'value()', '[attr.aria-valuemax]': 'max()' },
  template: `<div class="h-full rounded-full transition-[width] duration-500 ease-soft" [style.width.%]="percent()" [style.background]="color()"></div>`,
})
export class Bar {
  readonly value = input(0);
  readonly max = input(1);
  readonly color = input('var(--accent)');
  protected readonly percent = computed(() => (this.max() > 0 ? Math.min(100, Math.max(0, (this.value() / this.max()) * 100)) : 0));
}

/** Feuille modale ancrée en bas d'écran. */
@Component({
  selector: 'app-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="sheet-backdrop" [class.elevated]="elevated()" (click)="closed.emit()"></div>
    <section class="sheet" [class.elevated]="elevated()" role="dialog" aria-modal="true" [attr.aria-label]="title()">
      @if (title()) {
        <header class="row mb-4">
          <h2 class="text-xl font-bold">{{ title() }}</h2>
          <button type="button" class="grid size-9 place-items-center rounded-full bg-raised text-muted" (click)="closed.emit()" aria-label="Fermer">
            <app-icon name="x" [size]="18" />
          </button>
        </header>
      }
      <ng-content />
    </section>
  `,
  imports: [Icon],
})
export class Sheet {
  readonly title = input('');
  /** Passe au-dessus d'un écran plein cadre (scanner). */
  readonly elevated = input(false);
  readonly closed = output<void>();
}

@Pipe({ name: 'grams' })
export class GramsPipe implements PipeTransform {
  transform(value: number | null | undefined, unit: 'g' | 'ml' = 'g'): string {
    return value == null ? '—' : formatGrams(value, unit);
  }
}

@Pipe({ name: 'euro' })
export class EuroPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return value == null ? '—' : formatEuro(value);
  }
}

@Pipe({ name: 'num' })
export class NumPipe implements PipeTransform {
  transform(value: number | null | undefined, digits = 0): string {
    return value == null ? '—' : value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
}

/** « lun. 12 oct. » à partir d'une date ISO. */
@Pipe({ name: 'day' })
export class DayPipe implements PipeTransform {
  transform(iso: string | null | undefined, style: 'short' | 'long' = 'short'): string {
    if (!iso) return '';
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    const date = new Date(y!, (m ?? 1) - 1, d ?? 1);
    return date.toLocaleDateString('fr-FR', style === 'long' ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
  }
}

export const UI = [Icon, Ring, Bar, Sheet, GramsPipe, EuroPipe, NumPipe, DayPipe] as const;
