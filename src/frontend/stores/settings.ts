import { create } from 'zustand';

type Theme = 'dark' | 'light';
type FontSize = 'small' | 'medium' | 'large';

interface SettingsState {
  theme: Theme;
  fontSize: FontSize;
  setTheme: (theme: Theme) => void;
  setFontSize: (size: FontSize) => void;
}

const STORAGE_KEY = 'canopytag-settings';

function loadSettings(): { theme: Theme; fontSize: FontSize } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        theme: parsed.theme === 'light' ? 'light' : 'dark',
        fontSize: (['small', 'medium', 'large'] as const).includes(parsed.fontSize) ? parsed.fontSize : 'medium',
      };
    }
  } catch { /* ignore */ }
  return { theme: 'dark', fontSize: 'medium' };
}

function applySettings(theme: Theme, fontSize: FontSize) {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-font', fontSize);
}

function saveSettings(theme: Theme, fontSize: FontSize) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, fontSize }));
}

const initial = loadSettings();
applySettings(initial.theme, initial.fontSize);

export const useSettings = create<SettingsState>((set) => ({
  theme: initial.theme,
  fontSize: initial.fontSize,
  setTheme: (theme) => {
    set({ theme });
    applySettings(theme, useSettings.getState().fontSize);
    saveSettings(theme, useSettings.getState().fontSize);
  },
  setFontSize: (fontSize) => {
    set({ fontSize });
    applySettings(useSettings.getState().theme, fontSize);
    saveSettings(useSettings.getState().theme, fontSize);
  },
}));
