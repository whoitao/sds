/**
 * SDS 设计 Token 的唯一来源之一：Tailwind preset。
 * 色板与字号同时被 Admin 的 Antd 主题、Web 端 Tailwind、Mobile 端主题常量引用。
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f2f8fd',
          100: '#e3f0fb',
          500: '#4a90d9',
          600: '#3a7bc0',
          700: '#2f659e'
        },
        paper: '#fdfcf9'
      },
      fontSize: {
        // 老年友好：正文不小于 18px
        'senior-base': ['18px', { lineHeight: '1.8' }],
        'senior-lg': ['20px', { lineHeight: '1.8' }],
        'senior-xl': ['24px', { lineHeight: '1.6' }]
      }
    }
  }
};
