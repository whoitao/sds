/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@sds/config/tailwind/preset')],
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Web 顾客端色板：唯一定义处，取自 docs/design/web-customer-mockup.html
      // 所有颜色都映射到 globals.css 里的主题变量，深色模式只替换变量值
      colors: {
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)'
        },
        // 实心主按钮：浅色深绿底白字，深色用稍亮的绿保证对比度
        primary: {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          hover: 'rgb(var(--primary-hover) / <alpha-value>)'
        },
        paper: 'rgb(var(--paper) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        'card-soft': 'rgb(var(--card-soft) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          2: 'rgb(var(--ink-2) / <alpha-value>)',
          3: 'rgb(var(--ink-3) / <alpha-value>)'
        },
        line: 'rgb(var(--line) / <alpha-value>)',
        segment: 'rgb(var(--segment) / <alpha-value>)',
        amber: {
          DEFAULT: 'rgb(var(--amber) / <alpha-value>)',
          soft: 'rgb(var(--amber-soft) / <alpha-value>)',
          ink: 'rgb(var(--amber-ink) / <alpha-value>)'
        },
        info: {
          DEFAULT: 'rgb(var(--info) / <alpha-value>)',
          soft: 'rgb(var(--info-soft) / <alpha-value>)'
        },
        danger: {
          DEFAULT: 'rgb(var(--danger) / <alpha-value>)',
          soft: 'rgb(var(--danger-soft) / <alpha-value>)'
        },
        // 商品/门店缩略图与地图底色
        thumb: {
          from: 'rgb(var(--thumb-from) / <alpha-value>)',
          to: 'rgb(var(--thumb-to) / <alpha-value>)',
          muted: 'rgb(var(--thumb-muted-from) / <alpha-value>)',
          'muted-to': 'rgb(var(--thumb-muted-to) / <alpha-value>)'
        },
        map: 'rgb(var(--map-bg) / <alpha-value>)'
      },
      // 设计稿中的投影规格，避免在组件里散落硬编码
      boxShadow: {
        perk: '0 1px 2px rgba(40,60,45,0.05), 0 6px 18px rgba(40,60,45,0.06)',
        auth: '0 12px 40px rgba(30,42,34,0.10)',
        segment: '0 2px 6px rgba(30,42,34,0.08)'
      }
    }
  },
  plugins: []
};
