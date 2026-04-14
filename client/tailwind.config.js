/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fff7ed',
          100: '#fff3e6',
          200: '#ffe4c4',
          300: '#ffc78a',
          400: '#ffa54d',
          500: '#ff7f00',
          600: '#e56d00',
          700: '#cc5f00',
          800: '#a34d00',
          900: '#7a3a00',
          950: '#4d2400',
        },
        secondary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#1863dc',
          600: '#1452b8',
          700: '#103e8a',
          800: '#0c2d63',
          900: '#081c3d',
        },
        navy: {
          DEFAULT: '#181b31',
          light: '#293c5b',
        },
        brand: {
          light: '#fff3e6',
          DEFAULT: '#ff7f00',
          dark: '#e56d00',
        },
      },
      fontFamily: {
        sans: ['Poppins', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)',
      },
      fontSize: {
        display: ['2.25rem', { lineHeight: '2.5rem', fontWeight: '700' }],
        label: ['0.75rem', { lineHeight: '1rem', fontWeight: '500', letterSpacing: '0.05em' }],
      },
    },
  },
  plugins: [],
};
