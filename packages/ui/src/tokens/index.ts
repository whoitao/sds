/** SDS 设计 Token（三端共用，与 packages/config/tailwind/preset.js 对齐） */
export const colors = {
  brand: '#4a90d9',
  brandDark: '#3a7bc0',
  paper: '#fdfcf9',
  surface: '#ffffff',
  border: '#e3f0fb',
  text: '#1f2329',
  textSecondary: '#5c6672'
} as const;

/** 老年友好字号基线：正文 ≥ 18px，关键操作 ≥ 20px */
export const fontSize = {
  base: 18,
  lg: 20,
  xl: 24
} as const;
