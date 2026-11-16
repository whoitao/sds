/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@sds/config/tailwind/preset')],
  content: ['./app/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {}
  },
  plugins: []
};
