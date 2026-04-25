import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/frontend/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        brand: ['"Plus Jakarta Sans"', 'Manrope', 'system-ui', 'sans-serif'],
      },
      spacing: {
        'grid-1': '0.5rem',
        'grid-2': '1rem',
        'grid-3': '1.5rem',
        'grid-4': '2rem',
        'grid-5': '2.5rem',
        'grid-6': '3rem',
      },
      colors: {
        forest: {
          50:  'var(--forest-50)',
          100: 'var(--forest-100)',
          200: 'var(--forest-200)',
          300: 'var(--forest-300)',
          400: 'var(--forest-400)',
          500: 'var(--forest-500)',
          600: 'var(--forest-600)',
          700: 'var(--forest-700)',
          800: 'var(--forest-800)',
          900: 'var(--forest-900)',
          950: 'var(--forest-950)',
        },
        // Semantic surface / text / accent
        canvas:          'var(--color-bg)',
        surface: {
          DEFAULT:       'var(--color-surface)',
          hover:         'var(--color-surface-hover)',
        },
        border:          'var(--color-border)',
        text: {
          primary:       'var(--color-text-primary)',
          secondary:     'var(--color-text-secondary)',
          muted:         'var(--color-text-muted)',
        },
        // Top-level key: generates class `text-on-accent` (not nested
        // under `text.*` — that would produce `text-text-on-accent`).
        'on-accent':     'var(--color-text-on-accent)',
        accent: {
          DEFAULT:       'var(--color-accent)',
          hover:         'var(--color-accent-hover)',
        },
        // Status
        error: {
          DEFAULT: 'var(--color-error)',
          muted: 'var(--color-error-muted)',
          text: 'var(--color-error-text)',
        },
        warning: 'var(--color-warning)',
        success: 'var(--color-success)',
        // Priority
        p1: 'var(--color-p1)',
        p2: 'var(--color-p2)',
        p3: 'var(--color-p3)',
        p4: 'var(--color-p4)',
        p5: 'var(--color-p5)',
        // Closeness
        closeness: {
          5: 'var(--color-closeness-5)',
          4: 'var(--color-closeness-4)',
          3: 'var(--color-closeness-3)',
          2: 'var(--color-closeness-2)',
          1: 'var(--color-closeness-1)',
        },
        // Heat / engagement
        heat: {
          low:  'var(--color-heat-low)',
          med:  'var(--color-heat-med)',
          high: 'var(--color-heat-high)',
          max:  'var(--color-heat-max)',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
