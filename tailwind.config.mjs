import defaultTheme from 'tailwindcss/defaultTheme'

export default {
  content: [
    './src/**/*.{ts,tsx,html}',
    './manifest.json'
  ],
  prefix: 'lgd-',
  darkMode: 'media',
  corePlugins: {
    preflight: false
  },
  theme: {
    extend: {
      colors: {
        surface: 'rgba(15,23,42,0.92)',
        surfaceAlt: 'rgba(15,23,42,0.75)',
        outline: 'rgba(148, 163, 184, 0.25)',
        accent: '#3b82f6',
        accentHover: '#2563eb',
        danger: '#f87171'
      },
      boxShadow: {
        glow: '0 24px 48px rgba(15, 23, 42, 0.45)'
      },
      fontFamily: {
        sans: ['Inter', ...defaultTheme.fontFamily.sans]
      }
    }
  }
}
