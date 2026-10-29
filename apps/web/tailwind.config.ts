import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef9f4',
          100: '#d6f0e2',
          200: '#afe1c8',
          300: '#7bcba8',
          400: '#45ae85',
          500: '#22916a',
          600: '#147555',
          700: '#105d46',
          800: '#104a39',
          900: '#0e3d31',
          950: '#06231c',
        },
        ink: {
          50: '#f5f7f7',
          100: '#e9edec',
          200: '#d1d9d6',
          300: '#aebbb7',
          400: '#83958f',
          500: '#647771',
          600: '#4f615c',
          700: '#414f4b',
          800: '#37423f',
          900: '#303937',
          950: '#191f1d',
        },
        accent: {
          50: '#fff8eb',
          100: '#ffecc6',
          200: '#ffd788',
          300: '#ffbd4a',
          400: '#ffa31a',
          500: '#f58207',
          600: '#d95f02',
          700: '#b44206',
          800: '#92330c',
          900: '#782b0d',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)',
        pop: '0 12px 32px rgba(16, 24, 40, 0.16)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-in': 'slide-in 200ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
