import { Injectable, computed, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'diagramador-theme';

@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly mode = signal<ThemeMode>(readInitialTheme());

  readonly current = this.mode.asReadonly();
  readonly isDark = computed(() => this.mode() === 'dark');

  constructor() {
    applyTheme(this.mode());
  }

  toggle(): void {
    this.set(this.mode() === 'dark' ? 'light' : 'dark');
  }

  set(mode: ThemeMode): void {
    this.mode.set(mode);
    applyTheme(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  }
}

function readInitialTheme(): ThemeMode {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-bs-theme');
    if (attr === 'light' || attr === 'dark') {
      return attr;
    }
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // Storage may be unavailable in restricted contexts.
  }

  return 'light';
}

function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute('data-bs-theme', mode);
  document.documentElement.style.colorScheme = mode;
}
