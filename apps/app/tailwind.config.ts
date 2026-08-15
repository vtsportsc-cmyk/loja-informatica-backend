import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#22c55e',
          dark: '#15803d',
        },
        // Paleta "Gray UI": fundo denso em cinza escuro com superficies
        // hierarquizadas (Linear/Vercel Dashboard). Alinhada ao grayscale do
        // zinc para bordas limpas e acentos sutis.
        night: {
          950: '#09090b',
          900: '#18181b',
          800: '#27272a',
          700: '#3f3f46',
          600: '#52525b',
          500: '#71717a',
        },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(0 0 0 / 0.35)',
        pop: '0 12px 32px -8px rgb(0 0 0 / 0.7)',
        glow: '0 0 16px -4px rgb(244 63 94 / 0.55)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
