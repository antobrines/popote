/**
 * Mode Courses côté appareil : la session vit dans IndexedDB et fonctionne sans réseau.
 * Elle est synchronisée avec le serveur dès que possible, et la clôture est mise en file
 * si la connexion manque au moment de « Terminer mes courses ».
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import {
  ChainProductResolver,
  type ProductResolver,
  type PurchaseSummary,
  type ResolveOutcome,
  type ScannedProduct,
  type ShoppingSession,
  createSession,
  finishSession,
  sessionTotals,
} from '@bouffe/core';
import { Api, OfflineError } from './api';
import { LocalDb } from './db';
import type { AppState, ShoppingListJson, StoreJson } from './models';
import { Store } from './store';

const SESSION_KEY = 'shopping-session';

/** Produits connus de l'appareil : codes-barres mis en cache avant d'entrer dans le magasin et scans précédents. */
class DeviceResolver implements ProductResolver {
  readonly name = 'appareil';

  constructor(private readonly db: LocalDb) {}

  async resolve(ean: string): Promise<ScannedProduct | null> {
    const product = await this.db.get<ScannedProduct>(ean, 'barcodes');
    return product ? { ...product, source: 'local' } : null;
  }
}

/** Le serveur enchaîne lui-même : prix du magasin → produits scannés → catalogue → Open Food Facts. */
class ServerResolver implements ProductResolver {
  readonly name = 'serveur';

  constructor(
    private readonly api: Api,
    private readonly storeId: () => string | undefined,
  ) {}

  async resolve(ean: string): Promise<ScannedProduct | null> {
    const storeId = this.storeId();
    const outcome = await this.api.get<ResolveOutcome>(`/barcodes/${ean}${storeId ? `?storeId=${storeId}` : ''}`);
    return outcome.product;
  }
}

@Injectable({ providedIn: 'root' })
export class ShoppingSessions {
  private readonly api = inject(Api);
  private readonly db = inject(LocalDb);
  private readonly store = inject(Store);

  readonly session = signal<ShoppingSession | null>(null);
  readonly totals = computed(() => {
    const s = this.session();
    return s ? sessionTotals(s) : null;
  });
  readonly synced = signal(true);

  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly resolver = new ChainProductResolver(
    [new DeviceResolver(this.db), new ServerResolver(this.api, () => this.session()?.storeId || this.store.currentStore()?.id)],
    6000,
  );

  async restore(): Promise<void> {
    const local = await this.db.get<ShoppingSession>(SESSION_KEY);
    if (local?.status === 'active') {
      this.session.set(local);
      return;
    }
    const remote = this.store.state()?.activeSession;
    if (remote) this.session.set(remote);
  }

  /**
   * Démarre les courses : crée la session et met en cache tout ce qu'il faut pour tenir
   * sans réseau dans le magasin (liste, produits prévus, codes-barres et prix connus).
   */
  async start(list: ShoppingListJson, store: StoreJson | null): Promise<void> {
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `s-${Date.now()}`;
    const session = createSession(
      id,
      list.id,
      list,
      { id: store?.id ?? '', name: store?.name ?? 'Magasin', aisleOrder: store?.aisleOrder?.length ? store.aisleOrder : undefined },
      new Date().toISOString(),
    );
    await this.cacheKnownBarcodes();
    this.commit(session);
  }

  async cacheKnownBarcodes(): Promise<void> {
    const known = this.store.state()?.knownBarcodes ?? [];
    await this.db.setMany(
      known.filter((p) => !!p.ean).map((p) => [p.ean!, p] as [string, unknown]),
      'barcodes',
    );
  }

  /** Applique une transition pure du cœur métier, persiste localement, puis synchronise. */
  update(transition: (session: ShoppingSession) => ShoppingSession): void {
    const current = this.session();
    if (current) this.commit(transition(current));
  }

  private commit(session: ShoppingSession): void {
    this.session.set(session);
    this.synced.set(false);
    void this.db.set(SESSION_KEY, session);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.sync(), 1500);
  }

  private async sync(): Promise<void> {
    const session = this.session();
    if (!session) return;
    try {
      await this.api.request('PUT', `/shopping-sessions/${session.id}`, { session });
      this.synced.set(true);
      this.store.online.set(true);
    } catch (error) {
      if (error instanceof OfflineError) this.store.online.set(false);
    }
  }

  /** Identifie un produit : appareil d'abord, serveur ensuite. Ne lève jamais d'erreur. */
  async lookup(ean: string): Promise<ScannedProduct | null> {
    const product = await this.resolver.resolve(ean);
    return product ? { ...product, ean } : null;
  }

  /** Mémorise un produit et son prix sur l'appareil pour les prochains scans (même hors ligne). */
  async remember(product: ScannedProduct): Promise<void> {
    if (product.ean) await this.db.set(product.ean, { ...product, priceDate: product.price !== undefined ? new Date().toISOString() : product.priceDate }, 'barcodes');
  }

  async abandon(): Promise<void> {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.session.set(null);
    await this.db.delete(SESSION_KEY);
  }

  /**
   * « Terminer mes courses ». Le résumé est calculé localement (donc disponible hors ligne) ;
   * le serveur applique ensuite les mêmes règles pour mettre à jour stocks, prix et historique.
   */
  async finish(): Promise<{ purchase: PurchaseSummary; synced: boolean } | null> {
    const session = this.session();
    if (!session) return null;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    const { purchase } = finishSession(session, new Date().toISOString());
    const path = `/shopping-sessions/${session.id}/finish`;
    const body = { today: this.store.today(), session };
    let synced = false;
    try {
      const result = await this.api.request<{ purchase: PurchaseSummary; state: AppState }>('POST', path, body);
      this.store.adopt(result.state);
      synced = true;
    } catch (error) {
      if (error instanceof OfflineError) {
        this.store.online.set(false);
        this.store.queue({ method: 'POST', path, body, label: 'clôture des courses' });
      } else {
        throw error;
      }
    }
    this.session.set(null);
    await this.db.delete(SESSION_KEY);
    return { purchase, synced };
  }
}
