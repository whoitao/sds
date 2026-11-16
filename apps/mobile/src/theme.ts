/**
 * 移动端顾客侧主题令牌，取自 docs/design/elder-order-flow.html。
 * 字号按 PRD 7.3 适老化下限：正文最小 16，商品名 18，标题 20+；
 * 点按区域按 PRD「按钮高度 ≥ 48px」，不沿用设计图里 44px 的导航尺寸。
 */
export const colors = {
  paper: '#F7F6F1',
  card: '#FFFFFF',
  cardSoft: '#FCFBF6',
  ink: '#1E2A22',
  ink2: '#55655A',
  ink3: '#8A9690',
  line: '#E3E7DF',
  green: '#4C9A6A',
  greenDeep: '#2F6B47',
  greenSoft: '#E8F3EC',
  amber: '#C9852B',
  amberSoft: '#FBF1DF',
  blue: '#4A7FB5',
  blueSoft: '#E9F0F8',
  blueInk: '#2C5480',
  danger: '#B4534A',
  white: '#FFFFFF'
};

export const fontSize = {
  mini: 14,
  body: 16,
  name: 18,
  title: 20,
  hero: 24,
  ok: 26,
  money: 28
};

/** 卡片统一投影：设计稿 header / 卡片 / 分类格共用一套轻投影 */
export const cardShadow = {
  shadowColor: colors.ink,
  shadowOpacity: 0.06,
  shadowRadius: 9,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2
};

export const radius = {
  sm: 10,
  md: 13,
  lg: 16
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24
};

/** 防误触点按下限（PRD ≥48） */
export const tap = {
  min: 48,
  primary: 56
};
