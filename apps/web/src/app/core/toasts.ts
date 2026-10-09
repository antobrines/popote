import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

@Injectable({ providedIn: 'root' })
export class Toasts {
  readonly items = signal<Toast[]>([]);
  private next = 1;

  private push(kind: Toast['kind'], text: string, ms: number): void {
    const id = this.next++;
    this.items.update((list) => [...list.slice(-2), { id, kind, text }]);
    setTimeout(() => this.dismiss(id), ms);
  }

  info(text: string): void {
    this.push('info', text, 3500);
  }

  success(text: string): void {
    this.push('success', text, 2800);
  }

  error(text: string): void {
    this.push('error', text, 5000);
  }

  dismiss(id: number): void {
    this.items.update((list) => list.filter((t) => t.id !== id));
  }
}

/** Thème clair / sombre / automatique, mémorisé sur l'appareil. */
@Injectable({ providedIn: 'root' })
export class Theme {
  readonly mode = signal<'auto' | 'light' | 'dark'>(this.read());

  private read(): 'auto' | 'light' | 'dark' {
    try {
      const stored = localStorage.getItem('bouffe.theme');
      return stored === 'light' || stored === 'dark' ? stored : 'auto';
    } catch {
      return 'auto';
    }
  }

  set(mode: 'auto' | 'light' | 'dark'): void {
    this.mode.set(mode);
    const root = document.documentElement;
    if (mode === 'auto') delete root.dataset['theme'];
    else root.dataset['theme'] = mode;
    try {
      if (mode === 'auto') localStorage.removeItem('bouffe.theme');
      else localStorage.setItem('bouffe.theme', mode);
    } catch {
      /* ignoré */
    }
  }
}
