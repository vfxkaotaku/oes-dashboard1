/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        oes: {
          blue: '#09292F',
          'blue-light': '#153A42',
          'blue-dark': '#051A1E',
          'blue-bg': '#F5F7FA',
          green: '#C5F03A',
          'green-light': '#D8F568',
          'green-dark': '#9BC120',
          'green-text': '#8FBC08',
          'green-bg': '#F8FCE6'
        }
      }
    },
  },
  plugins: [],
}
