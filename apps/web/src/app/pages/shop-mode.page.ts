/**
 * Mode Courses : écran plein cadre pensé pour le magasin — gros boutons, peu de texte,
 * utilisable d'une main, et fonctionnel sans réseau.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  type Aisle,
  DEFAULT_AISLE_ORDER,
  type MatchResult,
  type PurchaseSummary,
  type ScannedProduct,
  type ShoppingSessionItem,
  addExtra,
  addScan,
  aisleLabel,
  formatGrams,
  gotGrams,
  gotUnits,
  groupByAisle,
  isVariableWeightEan,
  itemStatus,
  matchScannedProduct,
  plannedUnits,
  priceFreshness,
  remainingGrams,
  removeScan,
  setManualDone,
  updateScan,
} from '@bouffe/core';
import { ScannerComponent, scanFeedback } from '../core/scanner';
import { ShoppingSessions } from '../core/shopping-session';
import { Store } from '../core/store';
import { Toasts } from '../core/toasts';
import { Bar, DayPipe, EuroPipe, GramsPipe, Icon, Sheet } from '../ui/ui';

interface Pending {
  product: ScannedProduct;
  match: MatchResult;
  /** Article de la liste auquel rattacher le scan, s'il y en a un. */
  itemId: string | null;
}

function uid(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

@Component({
  selector: 'app-shop-mode-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, Icon, Bar, Sheet, EuroPipe, GramsPipe, DayPipe, ScannerComponent],
  template: `
    @if (summary(); as s) {
      <div class="page flex min-h-dvh flex-col justify-center !pb-10">
        <div class="fade-in text-center">
          <div class="mx-auto grid size-20 place-items-center rounded-full bg-accent text-on-accent"><app-icon name="check" [size]="40" [stroke]="2.4" /></div>
          <h1 class="title mt-6">Courses terminées</h1>
        </div>
        <dl class="card num mt-8 space-y-3 text-lg">
          <div class="row">
            <dt class="text-muted">Prévu</dt>
            <dd class="font-semibold">{{ s.plannedTotal | euro }}</dd>
          </div>
          <div class="row">
            <dt class="text-muted">Réel</dt>
            <dd class="font-semibold">{{ s.actualTotal | euro }}</dd>
          </div>
          <div class="row border-t border-line pt-3">
            <dt class="font-semibold">{{ s.saving >= 0 ? 'Économie' : 'Dépassement' }}</dt>
            <dd class="text-2xl font-bold" [class]="s.saving >= 0 ? 'text-accent' : 'text-warn'">{{ abs(s.saving) | euro }}</dd>
          </div>
          @if (s.missing.length > 0) {
            <p class="text-xs text-muted">Calculée sur les produits achetés ({{ s.plannedBought | euro }} prévus) : un article manquant n'est pas une économie.</p>
          }
        </dl>
        <div class="card mt-3 space-y-2">
          <p class="num text-lg font-semibold">{{ s.itemsBought }} / {{ s.itemsPlanned }} produits achetés</p>
          @if (s.missing.length > 0) {
            <p class="font-semibold text-warn">{{ s.missing.length }} produit{{ s.missing.length > 1 ? 's' : '' }} manquant{{ s.missing.length > 1 ? 's' : '' }}</p>
            <ul class="text-sm text-muted">
              @for (m of s.missing; track m.foodId) {
                <li>{{ m.name }} — {{ m.missingG | grams }}</li>
              }
            </ul>
          }
          @if (unpriced() > 0) {
            <p class="text-sm text-muted">{{ unpriced() }} ligne{{ unpriced() > 1 ? 's' : '' }} sans prix : le total réel est partiel.</p>
          }
        </div>
        <p class="mt-4 text-center text-sm text-muted">
          {{ summarySynced() ? 'Achats ajoutés à tes stocks, prix mémorisés.' : 'Hors ligne : tes stocks et tes prix seront mis à jour dès le retour du réseau.' }}
        </p>
        <a routerLink="/courses" class="btn btn-dark btn-lg mt-8">Terminé</a>
      </div>
    } @else if (session(); as ses) {
      <div class="mx-auto flex min-h-dvh w-full max-w-[34rem] flex-col">
        <header class="sticky top-0 z-20 bg-bg/90 px-5 pb-3 backdrop-blur-xl" style="padding-top: calc(env(safe-area-inset-top) + 1rem)">
          <div class="row">
            <a routerLink="/courses" class="grid size-10 place-items-center rounded-full bg-card text-muted" aria-label="Quitter le mode Courses"><app-icon name="chevron-left" [size]="20" /></a>
            <h1 class="text-lg font-bold">Courses — {{ ses.storeName }}</h1>
            <button type="button" class="grid size-10 place-items-center rounded-full bg-card text-muted" (click)="openAisles()" aria-label="Ordre des rayons">
              <app-icon name="list" [size]="20" />
            </button>
          </div>
          <div class="mt-3 flex items-center gap-3">
            <app-bar class="flex-1 !h-2.5" [value]="totals()!.itemsDone" [max]="totals()!.itemsTotal" />
            <span class="num text-sm font-bold">{{ totals()!.itemsDone }} / {{ totals()!.itemsTotal }}</span>
          </div>
          @if (!store.online()) {
            <p class="mt-2 flex items-center gap-1.5 text-xs font-semibold text-muted"><app-icon name="wifi-off" [size]="12" /> Hors ligne — tout est enregistré sur ce téléphone</p>
          }
        </header>

        <div class="flex-1 space-y-5 px-5 pt-2 pb-48">
          @for (group of groups(); track group.aisle) {
            <section>
              <h2 class="eyebrow mb-2">{{ group.label }}</h2>
              <ul class="space-y-2">
                @for (item of group.items; track item.id) {
                  <li class="card !p-0" [class.opacity-55]="status(item) === 'done'">
                    <div class="flex items-center gap-3 p-4">
                      <button
                        type="button"
                        class="grid size-11 shrink-0 place-items-center rounded-full border-2 transition-colors"
                        [class]="status(item) === 'done' ? 'border-accent bg-accent text-on-accent' : 'border-line text-transparent'"
                        (click)="toggleDone(item)"
                        [attr.aria-label]="(status(item) === 'done' ? 'Remettre à faire : ' : 'Marquer comme pris : ') + item.name"
                        [attr.aria-pressed]="status(item) === 'done'"
                      >
                        <app-icon name="check" [size]="22" [stroke]="2.6" />
                      </button>
                      <button type="button" class="min-w-0 flex-1 text-left" (click)="toggleOpen(item.id)" [attr.aria-expanded]="open() === item.id">
                        <p class="text-lg leading-tight font-semibold">{{ item.name }}</p>
                        <p class="num mt-0.5 text-sm" [class]="status(item) === 'done' ? 'font-semibold text-accent' : 'text-muted'">{{ progress(item) }}</p>
                      </button>
                      @if (status(item) !== 'done') {
                        <button type="button" class="grid size-12 shrink-0 place-items-center rounded-full bg-fg text-bg" (click)="scan(item.id)" [attr.aria-label]="'Scanner ' + item.name">
                          <app-icon name="scan" [size]="22" />
                        </button>
                      }
                    </div>
                    @if (open() === item.id) {
                      <div class="fade-in space-y-2 border-t border-line px-4 py-3 text-sm">
                        <p class="num text-muted">Prévu : {{ plannedText(item) }} · {{ item.plannedCost | euro }}</p>
                        @for (line of item.scans; track line.id) {
                          <div class="flex items-center gap-2 rounded-2xl bg-raised px-3 py-2">
                            <div class="min-w-0 flex-1">
                              <p class="truncate font-medium">{{ line.name }}{{ line.brand ? ' · ' + line.brand : '' }}</p>
                              <p class="num text-xs text-muted">
                                {{ line.grams | grams: item.unit }}
                                @if (line.price !== undefined) {
                                  · {{ line.price | euro }}
                                } @else {
                                  · prix inconnu
                                }
                                @if (line.substitution) {
                                  · remplacement
                                }
                              </p>
                            </div>
                            <button type="button" class="grid size-9 place-items-center rounded-full bg-card" (click)="setQty(line.id, line.qty - 1)" aria-label="Retirer une unité">
                              <app-icon name="minus" [size]="16" />
                            </button>
                            <span class="num w-5 text-center font-bold">{{ line.qty }}</span>
                            <button type="button" class="grid size-9 place-items-center rounded-full bg-card" (click)="setQty(line.id, line.qty + 1)" aria-label="Ajouter une unité">
                              <app-icon name="plus" [size]="16" />
                            </button>
                          </div>
                        }
                      </div>
                    }
                  </li>
                }
              </ul>
            </section>
          }

          @if (ses.extras.length > 0) {
            <section>
              <h2 class="eyebrow mb-2">Hors liste</h2>
              <ul class="card divide !py-1">
                @for (line of ses.extras; track line.id) {
                  <li class="row py-3">
                    <div class="min-w-0">
                      <p class="truncate font-medium">{{ line.name }}</p>
                      <p class="num text-xs text-muted">{{ line.destination === 'stock' ? 'Ajouté aux stocks' : 'Dans le panier' }}{{ line.price !== undefined ? ' · ' + (line.price | euro) : '' }}</p>
                    </div>
                    <button type="button" class="grid size-9 place-items-center rounded-full bg-raised text-muted" (click)="remove(line.id)" aria-label="Retirer"><app-icon name="trash" [size]="16" /></button>
                  </li>
                }
              </ul>
            </section>
          }
        </div>

        <footer class="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/90 backdrop-blur-xl" style="padding-bottom: env(safe-area-inset-bottom)">
          <div class="mx-auto max-w-[34rem] space-y-3 px-5 py-4">
            <div class="row">
              <p class="text-sm font-semibold text-muted">{{ totals()!.itemsDone }} produit{{ totals()!.itemsDone > 1 ? 's' : '' }} récupéré{{ totals()!.itemsDone > 1 ? 's' : '' }}</p>
              <p class="num text-right">
                <span class="text-xl font-bold">{{ totals()!.actualTotal | euro }}</span>
                <span class="block text-xs text-muted">prévu {{ totals()!.plannedTotal | euro }}</span>
              </p>
            </div>
            <div class="flex gap-2">
              <button type="button" class="btn btn-primary btn-lg flex-[2]" (click)="scan(null)">
                <app-icon name="scan" />
                Scanner un produit
              </button>
              <button type="button" class="btn btn-lg flex-1 !px-2 text-sm" (click)="finishSheet.set(true)">Terminer</button>
            </div>
          </div>
        </footer>
      </div>
    } @else {
      <div class="page flex min-h-dvh flex-col items-center justify-center text-center">
        <app-icon name="cart" [size]="40" class="text-muted" />
        <h1 class="mt-4 text-xl font-bold">Aucune session de courses en cours</h1>
        <a routerLink="/courses" class="btn btn-primary btn-lg mt-6">Voir ma liste</a>
      </div>
    }

    @if (scanning()) {
      <app-scanner (code)="onCode($event)" (closed)="scanning.set(false)" />
    }

    @if (looking()) {
      <div class="fixed inset-0 z-[65] grid place-items-center bg-black/50" role="status">
        <p class="rounded-2xl bg-card px-5 py-4 font-semibold shadow-lg">Recherche du produit…</p>
      </div>
    }

    @if (pending(); as p) {
      <app-sheet [title]="sheetTitle(p)" (closed)="pending.set(null)">
        <div class="space-y-4">
          <div class="card">
            <p class="text-lg leading-tight font-semibold">{{ p.product.name }}</p>
            <p class="num mt-1 text-sm text-muted">
              {{ p.product.brand ?? 'Marque inconnue' }}
              @if (p.product.grams) {
                · {{ p.product.grams | grams }}
              }
              @if (p.product.ean) {
                · {{ p.product.ean }}
              }
            </p>
            @if (targetItem(); as item) {
              <p class="num mt-3 border-t border-line pt-3 text-sm">
                <span class="font-semibold">{{ item.name }}</span> — attendu : {{ plannedText(item) }}, {{ remaining(item) | grams: item.unit }} restants
              </p>
            }
          </div>

          @for (reason of p.match.reasons; track reason) {
            <p class="flex gap-2 text-sm text-muted"><app-icon name="info" [size]="16" class="mt-0.5" /> {{ reason }}</p>
          }
          @for (warning of p.match.warnings; track warning) {
            <p class="flex gap-2 rounded-2xl bg-warn-soft px-3 py-2 text-sm text-warn"><app-icon name="alert" [size]="16" class="mt-0.5" /> {{ warning }}</p>
          }
          @if (p.match.kind === 'substitute' && p.match.deltas; as d) {
            @if (d.weeklyKcal !== 0) {
              <p class="num text-sm text-muted">Impact sur la semaine : {{ d.weeklyKcal > 0 ? '+' : '' }}{{ d.weeklyKcal }} kcal au total.</p>
            }
          }

          @if (p.match.kind !== 'rejected' || p.itemId === null) {
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="label" for="s-qty">Quantité</label>
                <input id="s-qty" class="input num text-center text-lg font-semibold" type="number" inputmode="numeric" min="1" [(ngModel)]="form.qty" />
              </div>
              <div>
                <label class="label" for="s-grams">Poids (g)</label>
                <input
                  id="s-grams"
                  class="input num text-center text-lg font-semibold"
                  [class]="needsWeight(p) && !form.grams ? '!border-warn' : ''"
                  type="number"
                  inputmode="numeric"
                  min="1"
                  [(ngModel)]="form.grams"
                />
              </div>
              <div>
                <label class="label" for="s-price">Prix (€)</label>
                <input id="s-price" class="input num text-center text-lg font-semibold" type="number" inputmode="decimal" min="0" step="0.01" placeholder="—" [(ngModel)]="form.price" />
              </div>
            </div>
            @if (needsWeight(p)) {
              <p class="text-xs text-muted">Produit au poids : saisis le poids réel indiqué sur l'étiquette.</p>
            }
            @if (p.product.price !== undefined && p.product.priceDate) {
              <p class="text-xs" [class]="priceStale(p.product) ? 'text-warn' : 'text-muted'">
                Prix relevé le {{ p.product.priceDate | day }}{{ priceStale(p.product) ? ' — peut avoir changé, vérifie l’étiquette.' : '.' }}
              </p>
            }
          }

          @switch (p.match.kind) {
            @case ('exact') {
              <button type="button" class="btn btn-primary btn-lg" [disabled]="!form.grams" (click)="confirmItem(p)"><app-icon name="check" /> Confirmer</button>
            }
            @case ('substitute') {
              <button type="button" class="btn btn-primary btn-lg" [disabled]="!form.grams" (click)="confirmItem(p)">Utiliser ce produit à la place</button>
              <button type="button" class="btn w-full" (click)="pending.set(null)">Annuler</button>
            }
            @default {
              @if (p.match.kind === 'unplanned') {
                <p class="rounded-2xl bg-card px-4 py-3 font-semibold">Ce produit n'est pas prévu cette semaine.</p>
              }
              <div class="space-y-2">
                <button type="button" class="btn w-full bg-card" (click)="confirmExtra(p, 'cart')">Ajouter quand même au panier</button>
                <div class="flex gap-2">
                  <select class="input flex-1" [(ngModel)]="form.stockFood" aria-label="Aliment correspondant">
                    <option value="">Ajouter à mes stocks comme…</option>
                    @for (food of store.foodList(); track food.id) {
                      <option [value]="food.id">{{ food.name }}</option>
                    }
                  </select>
                  <button type="button" class="btn" [disabled]="!form.stockFood || !form.grams" (click)="confirmExtra(p, 'stock')">OK</button>
                </div>
                <div class="flex gap-2">
                  <select class="input flex-1" [(ngModel)]="form.replaceItem" aria-label="Produit de la liste à remplacer">
                    <option value="">Remplacer un produit de la liste…</option>
                    @for (item of todoItems(); track item.id) {
                      <option [value]="item.id">{{ item.name }}</option>
                    }
                  </select>
                  <button type="button" class="btn" [disabled]="!form.replaceItem || !form.grams" (click)="confirmReplace(p)">OK</button>
                </div>
                <button type="button" class="btn w-full" (click)="pending.set(null)">Ignorer</button>
              </div>
            }
          }
        </div>
      </app-sheet>
    }

    @if (unknownEan(); as ean) {
      <app-sheet title="Produit inconnu" (closed)="unknownEan.set(null)">
        <form class="space-y-4" (ngSubmit)="submitUnknown(ean)">
          <p class="text-muted">
            Le code <span class="num font-semibold text-fg">{{ ean }}</span> n'a été trouvé dans aucune base{{ store.online() ? '' : ' (tu es hors ligne)' }}. Décris-le une fois : il sera
            reconnu aux prochaines courses.
          </p>
          <div>
            <label class="label" for="u-name">Nom du produit</label>
            <input id="u-name" class="input" name="name" required maxlength="120" [(ngModel)]="unknown.name" />
          </div>
          <div>
            <label class="label" for="u-item">Correspond à</label>
            <select id="u-item" class="input" name="item" [(ngModel)]="unknown.itemId">
              <option value="">Aucun article de la liste</option>
              @for (item of todoItems(); track item.id) {
                <option [value]="item.id">{{ item.name }}</option>
              }
            </select>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label" for="u-grams">Poids (g)</label>
              <input id="u-grams" class="input num" name="grams" type="number" inputmode="numeric" min="1" required [(ngModel)]="unknown.grams" />
            </div>
            <div>
              <label class="label" for="u-price">Prix (€)</label>
              <input id="u-price" class="input num" name="price" type="number" inputmode="decimal" min="0" step="0.01" [(ngModel)]="unknown.price" />
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-lg" [disabled]="!unknown.name || !unknown.grams">Ajouter</button>
        </form>
      </app-sheet>
    }

    @if (finishSheet()) {
      <app-sheet title="Terminer mes courses ?" (closed)="finishSheet.set(false)">
        <div class="space-y-4">
          @if (missingItems().length > 0) {
            <div class="card">
              <p class="font-semibold text-warn">{{ missingItems().length }} article{{ missingItems().length > 1 ? 's' : '' }} non récupéré{{ missingItems().length > 1 ? 's' : '' }}</p>
              <ul class="mt-2 space-y-1 text-sm text-muted">
                @for (item of missingItems(); track item.id) {
                  <li class="row">
                    <span>{{ item.name }}</span>
                    <span class="num">{{ remaining(item) | grams: item.unit }}</span>
                  </li>
                }
              </ul>
            </div>
          } @else {
            <p class="card font-semibold text-accent">Tous les articles sont récupérés.</p>
          }
          <p class="text-sm text-muted">Les produits achetés seront ajoutés à tes stocks et leurs prix mémorisés pour ce magasin.</p>
          <button type="button" class="btn btn-primary btn-lg" [disabled]="finishing()" (click)="finish()">{{ finishing() ? 'Enregistrement…' : 'Terminer mes courses' }}</button>
          <button type="button" class="btn w-full" (click)="finishSheet.set(false)">Continuer mes courses</button>
          <button type="button" class="w-full py-2 text-sm font-semibold text-danger" (click)="abandon()">Abandonner sans rien enregistrer</button>
        </div>
      </app-sheet>
    }

    @if (aisleSheet()) {
      <app-sheet title="Ordre des rayons" (closed)="aisleSheet.set(false)">
        <div class="space-y-4">
          <p class="text-muted">Range les rayons dans l'ordre de ton parcours. Il est mémorisé pour ce magasin.</p>
          <ul class="card divide !py-1">
            @for (aisle of aisleDraft(); track aisle; let i = $index) {
              <li class="row py-2.5">
                <span class="font-medium">{{ label(aisle) }}</span>
                <span class="flex gap-1.5">
                  <button type="button" class="grid size-10 place-items-center rounded-full bg-raised disabled:opacity-30" [disabled]="i === 0" (click)="moveAisle(i, -1)" [attr.aria-label]="'Monter ' + label(aisle)">
                    <app-icon name="arrow-up" [size]="18" />
                  </button>
                  <button
                    type="button"
                    class="grid size-10 place-items-center rounded-full bg-raised disabled:opacity-30"
                    [disabled]="i === aisleDraft().length - 1"
                    (click)="moveAisle(i, 1)"
                    [attr.aria-label]="'Descendre ' + label(aisle)"
                  >
                    <app-icon name="arrow-down" [size]="18" />
                  </button>
                </span>
              </li>
            }
            <li class="py-3 text-sm text-muted">Caisses</li>
          </ul>
          <button type="button" class="btn btn-primary btn-lg" (click)="saveAisles()">Enregistrer cet ordre</button>
        </div>
      </app-sheet>
    }
  `,
})
export class ShopModePage {
  protected readonly store = inject(Store);
  private readonly sessions = inject(ShoppingSessions);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);

  protected readonly session = this.sessions.session;
  protected readonly totals = this.sessions.totals;
  protected readonly scanning = signal(false);
  protected readonly looking = signal(false);
  protected readonly pending = signal<Pending | null>(null);
  protected readonly unknownEan = signal<string | null>(null);
  protected readonly open = signal<string | null>(null);
  protected readonly finishSheet = signal(false);
  protected readonly finishing = signal(false);
  protected readonly aisleSheet = signal(false);
  protected readonly aisleDraft = signal<Aisle[]>([]);
  protected readonly summary = signal<PurchaseSummary | null>(null);
  protected readonly summarySynced = signal(true);
  protected readonly unpriced = signal(0);

  /** Article visé quand le scan est lancé depuis sa ligne. */
  private target: string | null = null;
  protected form: { qty: number; grams: number | null; price: number | null; stockFood: string; replaceItem: string } = {
    qty: 1,
    grams: null,
    price: null,
    stockFood: '',
    replaceItem: '',
  };
  protected unknown: { name: string; itemId: string; grams: number | null; price: number | null } = { name: '', itemId: '', grams: null, price: null };

  protected readonly groups = computed(() => {
    const session = this.session();
    if (!session) return [];
    const rank = (item: ShoppingSessionItem) => (itemStatus(item) === 'done' ? 1 : 0);
    return groupByAisle(session.items, session.aisleOrder).map((g) => ({
      aisle: g.aisle,
      label: aisleLabel(g.aisle),
      items: [...g.items].sort((a, b) => rank(a) - rank(b)),
    }));
  });

  protected readonly todoItems = computed(() => (this.session()?.items ?? []).filter((i) => itemStatus(i) !== 'done'));
  protected readonly missingItems = this.todoItems;
  protected readonly targetItem = computed(() => {
    const p = this.pending();
    return p?.itemId ? (this.session()?.items.find((i) => i.id === p.itemId) ?? null) : null;
  });

  // ───────────── Affichage ─────────────

  protected status(item: ShoppingSessionItem) {
    return itemStatus(item);
  }

  protected remaining(item: ShoppingSessionItem): number {
    return remainingGrams(item);
  }

  protected abs(value: number): number {
    return Math.abs(value);
  }

  protected label(aisle: Aisle): string {
    return aisleLabel(aisle);
  }

  protected plannedText(item: ShoppingSessionItem): string {
    return item.planned.map((p) => (p.variableWeight ? formatGrams(p.grams, item.unit) : `${p.count} × ${p.label}`)).join(' + ') || formatGrams(item.neededG, item.unit);
  }

  /** « 1 kg restant », « 2 / 4 pots », « 1 / 3 · 1 kg restants », « ✓ terminé ». */
  protected progress(item: ShoppingSessionItem): string {
    if (itemStatus(item) === 'done') return '✓ terminé';
    const left = remainingGrams(item);
    if (item.pieceGrams) {
      const needed = Math.ceil(item.neededG / item.pieceGrams);
      const got = Math.floor(gotGrams(item) / item.pieceGrams);
      // « pot de skyr » → « pots » : le nom complet est déjà sur la ligne.
      const word = (item.pieceLabel ?? 'pièce').split(' ')[0]!;
      return `${got} / ${needed} ${word}${needed > 1 ? 's' : ''}`;
    }
    const units = plannedUnits(item);
    if (units > 1) return `${gotUnits(item)} / ${units} · ${formatGrams(left, item.unit)} restants`;
    return `${formatGrams(left, item.unit)} restant${left >= 2 ? 's' : ''}`;
  }

  protected sheetTitle(p: Pending): string {
    switch (p.match.kind) {
      case 'exact':
        return 'Produit reconnu';
      case 'substitute':
        return 'Utiliser ce produit à la place ?';
      case 'rejected':
        return 'Produit déconseillé';
      default:
        return 'Hors liste';
    }
  }

  protected needsWeight(p: Pending): boolean {
    return !!p.product.variableWeight || (!!p.product.ean && isVariableWeightEan(p.product.ean)) || !p.product.grams;
  }

  protected priceStale(product: ScannedProduct): boolean {
    const freshness = priceFreshness(product.priceDate, this.store.today());
    return freshness === 'aging' || freshness === 'stale';
  }

  protected toggleOpen(id: string): void {
    this.open.update((current) => (current === id ? null : id));
  }

  // ───────────── Scan ─────────────

  protected scan(itemId: string | null): void {
    this.target = itemId;
    this.scanning.set(true);
  }

  protected async onCode(code: string): Promise<void> {
    this.scanning.set(false);
    this.looking.set(true);
    const product = await this.sessions.lookup(code);
    this.looking.set(false);
    if (!product) {
      this.unknown = { name: '', itemId: this.target ?? '', grams: null, price: null };
      this.unknownEan.set(code);
      return;
    }
    this.evaluate(product);
  }

  private evaluate(product: ScannedProduct): void {
    const session = this.session();
    if (!session) return;
    const prefs = this.store.user()?.preferences;
    let match = matchScannedProduct(product, session, this.store.foods(), {
      excludedFoods: prefs?.excludedFoods ?? [],
      bannedBrands: prefs?.bannedBrands ?? [],
    });
    let itemId = match.itemId ?? null;

    // Scan lancé depuis une ligne précise : si le produit n'y correspond pas, on propose de le compter pour elle.
    const target = this.target ? session.items.find((i) => i.id === this.target) : undefined;
    if (target && itemId !== target.id && match.kind !== 'rejected') {
      match = {
        ...match,
        kind: 'substitute',
        itemId: target.id,
        reasons: [`Ce produit n'a pas été reconnu comme « ${target.name} ». Tu peux quand même le compter pour cet article.`],
      };
      itemId = target.id;
    }

    const item = itemId ? session.items.find((i) => i.id === itemId) : undefined;
    this.form = {
      qty: 1,
      grams: product.variableWeight || (product.ean && isVariableWeightEan(product.ean)) ? null : (product.grams ?? (item && !item.planned[0]?.variableWeight ? (item.planned[0]?.grams ?? null) : null)),
      price: product.price ?? null,
      stockFood: match.foodId ?? '',
      replaceItem: '',
    };
    this.pending.set({ product, match, itemId });
  }

  private input(p: Pending, foodId: string | undefined, substitution: boolean) {
    const grams = Math.round(+(this.form.grams ?? 0));
    const price = this.form.price === null || this.form.price === undefined || `${this.form.price}` === '' ? undefined : Math.round(+this.form.price * 100) / 100;
    const product: ScannedProduct = { ...p.product, foodId, grams, price };
    return { lineId: uid(), product, grams, qty: Math.max(1, Math.round(+this.form.qty || 1)), price, substitution, at: new Date().toISOString() };
  }

  private done(product: ScannedProduct, message: string): void {
    void this.sessions.remember(product);
    scanFeedback();
    this.pending.set(null);
    this.unknownEan.set(null);
    this.target = null;
    this.toasts.success(message);
  }

  private afterItemScan(itemId: string, product: ScannedProduct): void {
    const item = this.session()?.items.find((i) => i.id === itemId);
    if (!item) return;
    this.done(product, itemStatus(item) === 'done' ? `${item.name} terminé ✓` : `${item.name} — ${this.progress(item)}`);
  }

  protected confirmItem(p: Pending): void {
    const item = this.targetItem();
    if (!item) return;
    const input = this.input(p, item.foodId, p.match.kind === 'substitute');
    this.sessions.update((s) => addScan(s, item.id, input));
    this.afterItemScan(item.id, input.product);
  }

  protected confirmReplace(p: Pending): void {
    const item = this.session()?.items.find((i) => i.id === this.form.replaceItem);
    if (!item) return;
    const input = this.input(p, item.foodId, true);
    this.sessions.update((s) => addScan(s, item.id, input));
    this.afterItemScan(item.id, input.product);
  }

  protected confirmExtra(p: Pending, destination: 'cart' | 'stock'): void {
    const foodId = destination === 'stock' ? this.form.stockFood || undefined : (p.match.foodId ?? undefined);
    const input = this.input(p, foodId, false);
    this.sessions.update((s) => addExtra(s, input, destination));
    this.done(input.product, destination === 'stock' ? 'Ajouté à tes stocks.' : 'Ajouté au panier, hors liste.');
  }

  protected submitUnknown(ean: string): void {
    if (!this.unknown.name || !this.unknown.grams) return;
    const item = this.session()?.items.find((i) => i.id === this.unknown.itemId);
    const price = this.unknown.price === null || `${this.unknown.price}` === '' ? undefined : Math.round(+this.unknown.price * 100) / 100;
    const product: ScannedProduct = { ean, name: this.unknown.name.trim(), grams: Math.round(+this.unknown.grams), price, foodId: item?.foodId, source: 'manual' };
    const input = { lineId: uid(), product, grams: product.grams, qty: 1, price, substitution: false, at: new Date().toISOString() };
    if (item) {
      this.sessions.update((s) => addScan(s, item.id, input));
      this.afterItemScan(item.id, product);
    } else {
      this.sessions.update((s) => addExtra(s, input, 'cart'));
      this.done(product, 'Ajouté au panier, hors liste.');
    }
  }

  // ───────────── Lignes ─────────────

  protected toggleDone(item: ShoppingSessionItem): void {
    const done = itemStatus(item) === 'done';
    if (done && item.scans.length > 0 && !item.manualDone) {
      this.open.set(item.id);
      this.toasts.info('Ajuste les quantités scannées ci-dessous pour rouvrir cet article.');
      return;
    }
    this.sessions.update((s) => setManualDone(s, item.id, !done, new Date().toISOString()));
    if (!done) scanFeedback();
  }

  protected setQty(lineId: string, qty: number): void {
    this.sessions.update((s) => updateScan(s, lineId, { qty }, new Date().toISOString()));
  }

  protected remove(lineId: string): void {
    this.sessions.update((s) => removeScan(s, lineId, new Date().toISOString()));
  }

  // ───────────── Rayons ─────────────

  protected openAisles(): void {
    const current = this.session()?.aisleOrder ?? [];
    this.aisleDraft.set([...current, ...DEFAULT_AISLE_ORDER.filter((a) => !current.includes(a))]);
    this.aisleSheet.set(true);
  }

  protected moveAisle(index: number, delta: number): void {
    this.aisleDraft.update((list) => {
      const next = [...list];
      const [moved] = next.splice(index, 1);
      next.splice(index + delta, 0, moved!);
      return next;
    });
  }

  protected saveAisles(): void {
    const order = this.aisleDraft();
    this.sessions.update((s) => ({ ...s, aisleOrder: order }));
    this.aisleSheet.set(false);
    const storeId = this.session()?.storeId;
    if (storeId && this.store.online()) void this.store.setAisleOrder(storeId, order);
  }

  // ───────────── Clôture ─────────────

  protected async finish(): Promise<void> {
    this.finishing.set(true);
    try {
      this.unpriced.set(this.totals()?.unpricedLines ?? 0);
      const result = await this.sessions.finish();
      if (result) {
        this.summarySynced.set(result.synced);
        this.summary.set(result.purchase);
      }
      this.finishSheet.set(false);
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Impossible de terminer les courses.');
    } finally {
      this.finishing.set(false);
    }
  }

  protected async abandon(): Promise<void> {
    await this.sessions.abandon();
    await this.router.navigateByUrl('/courses');
  }
}
