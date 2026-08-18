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
          blue: '#1565C0',
          green: '#00A651',
        }
      }
    },
  },
  plugins: [],
}
