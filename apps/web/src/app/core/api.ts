import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import type { UserJson } from './models';

/**
 * URL de base de l'API. `/api` en web (même origine, via le proxy ou le reverse proxy) ;
 * à surcharger par une URL absolue dans un wrapper natif Capacitor.
 */
export const API_URL = new InjectionToken<string>('API_URL', { factory: () => '/api' });

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Le réseau n'a pas répondu : l'opération peut être rejouée plus tard. */
export class OfflineError extends Error {
  constructor() {
    super('Hors connexion');
  }
}

interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: UserJson | null;
}

const SESSION_FLAG = 'bouffe.session';

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly base = inject(API_URL);
  /** L'access token ne vit qu'en mémoire ; le refresh token est un cookie httpOnly invisible du JavaScript. */
  private accessToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;

  /** Vrai si une session a été ouverte sur cet appareil (permet l'usage hors ligne du cache). */
  readonly hasSession = signal(this.readFlag());

  private readFlag(): boolean {
    try {
      return localStorage.getItem(SESSION_FLAG) === '1';
    } catch {
      return false;
    }
  }

  private setSession(token: string | null): void {
    this.accessToken = token;
    this.hasSession.set(!!token);
    try {
      if (token) localStorage.setItem(SESSION_FLAG, '1');
      else localStorage.removeItem(SESSION_FLAG);
    } catch {
      /* stockage indisponible : la session reste en mémoire */
    }
  }

  private async raw(method: string, path: string, body?: unknown): Promise<Response> {
    try {
      return await fetch(this.base + path, {
        method,
        credentials: 'include',
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new OfflineError();
    }
  }

  private async parse<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      // Une passerelle qui ne joint pas l'API se comporte comme une coupure réseau.
      if (response.status === 502 || response.status === 503 || response.status === 504) throw new OfflineError();
      const message = (data as { message?: string | string[] } | null)?.message;
      throw new ApiError(response.status, Array.isArray(message) ? message.join(' · ') : (message ?? `Erreur ${response.status}`));
    }
    return data as T;
  }

  /** Renouvelle l'access token grâce au cookie de session. */
  refresh(): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        const response = await this.raw('POST', '/auth/refresh');
        if (!response.ok) {
          if (response.status === 401) this.setSession(null);
          return false;
        }
        this.setSession((await this.parse<AuthResponse>(response)).accessToken);
        return true;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.accessToken && this.hasSession()) await this.refresh();
    let response = await this.raw(method, path, body);
    if (response.status === 401 && (await this.refresh())) {
      response = await this.raw(method, path, body);
    }
    return this.parse<T>(response);
  }

  /** Les inscriptions sont-elles ouvertes sur cette installation ? (Oui par défaut si le serveur ne répond pas.) */
  async signupOpen(): Promise<boolean> {
    try {
      const response = await this.raw('GET', '/health');
      return !response.ok || (await this.parse<{ signup?: boolean }>(response)).signup !== false;
    } catch {
      return true;
    }
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async login(email: string, password: string): Promise<UserJson> {
    const result = await this.parse<AuthResponse>(await this.raw('POST', '/auth/login', { email, password }));
    this.setSession(result.accessToken);
    return result.user!;
  }

  async register(email: string, password: string, displayName: string): Promise<UserJson> {
    const result = await this.parse<AuthResponse>(await this.raw('POST', '/auth/register', { email, password, displayName }));
    this.setSession(result.accessToken);
    return result.user!;
  }

  async logout(): Promise<void> {
    try {
      await this.raw('POST', '/auth/logout');
    } catch {
      /* hors ligne : la session locale est quand même fermée */
    }
    this.setSession(null);
  }
}
