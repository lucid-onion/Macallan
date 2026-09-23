/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['selector', 'html[data-theme="dark"]'],
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: 'var(--ink)', soft: 'var(--ink-soft)', faint: 'var(--ink-faint)' },
        line: { DEFAULT: 'var(--line)', soft: 'var(--line-soft)' },
        surface: { DEFAULT: 'var(--surface)', sunken: 'var(--surface-sunken)' },
        sidebar: {
          DEFAULT: 'var(--sidebar-bg)',
          raised: 'var(--sidebar-bg-raised)',
          text: 'var(--sidebar-text)',
        },
        steel: { DEFAULT: 'var(--steel)', dark: 'var(--steel-dark)', tint: 'var(--steel-tint)' },
        positive: { DEFAULT: 'var(--positive)', tint: 'var(--positive-tint)' },
        warning: { DEFAULT: 'var(--warning)', tint: 'var(--warning-tint)' },
        negative: { DEFAULT: 'var(--negative)', tint: 'var(--negative-tint)' },
      },
      fontFamily: {
        ui: ['"Noto Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        np: ['"Noto Sans Devanagari"', 'var(--font-ui)'],
      },
      borderRadius: { sm: '6px', md: '10px' },
      boxShadow: { card: '0 1px 2px rgba(20, 22, 26, 0.04)' },
    },
  },
  plugins: [],
};