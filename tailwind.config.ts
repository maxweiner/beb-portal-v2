import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Original theme (cream/forest green)
        cream: {
          DEFAULT: '#F5F0E8',
          2: '#EDE8DF',
        },
        forest: {
          DEFAULT: '#1D6B44',
          dark: '#14532d',
          light: '#22c55e',
          pale: '#f0fdf4',
        },
      },
      fontFamily: {
        sans: ['Lato', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
