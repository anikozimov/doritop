/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/index.html', './public/*.js', './src/seo.js', './src/legal.js'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
      colors: {
        brand: { green: '#059669', greenDark: '#047857', blue: '#0284C7', blueDark: '#0369A1' }
      }
    }
  },
  plugins: []
};
