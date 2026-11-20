/**
 * 移动端顾客侧主题令牌，取自 docs/design/elder-order-flow.html。
 * 字号按 PRD 7.3 适老化下限：正文最小 16，商品名 18，标题 20+；
 * 点按区域按 PRD「按钮高度 ≥ 48px」，不沿用设计图里 44px 的导航尺寸。
 *
 * 配色分浅色 / 深色两套语义令牌，键名完全一致；组件只读取 `theme.colors.xxx`，
 * 不直接写死色值，切换主题时整页一起变化。深浅色的取舍见本文件下方两套令牌。
 */

export interface ThemeColors {
  paper: string;
  card: string;
  cardSoft: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  green: string;
  greenDeep: string;
  greenSoft: string;
  /** 更浅的绿色底，用于成功提示条等大面积浅绿 */
  greenTint: string;
  edgeGreen: string;
  amber: string;
  amberSoft: string;
  edgeAmber: string;
  blue: string;
  blueSoft: string;
  blueInk: string;
  edgeBlue: string;
  danger: string;
  dangerSoft: string;
  edgeDanger: string;
  white: string;
  /** 弹窗遮罩 */
  backdrop: string;
  /** 图片上的半透明蒙层（门店封面等），按主题取浅/深 */
  overlayScrim: string;
  /** 蒙层上的主文字 */
  overlayInk: string;
  /** 蒙层上的次要文字 */
  overlayInk2: string;
  /** 蒙层上的强调文字（营业中） */
  overlayAccent: string;
}

export const lightColors: ThemeColors = {
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
  greenTint: '#F4FBF6',
  edgeGreen: '#BFE0CB',
  amber: '#C9852B',
  amberSoft: '#FBF1DF',
  edgeAmber: '#EBD7B4',
  blue: '#4A7FB5',
  blueSoft: '#E9F0F8',
  blueInk: '#2C5480',
  edgeBlue: '#C9DBEE',
  danger: '#B4534A',
  dangerSoft: '#FDF4F3',
  edgeDanger: '#E7C9C6',
  white: '#FFFFFF',
  backdrop: 'rgba(16, 24, 20, 0.4)',
  // 浅色模式用 82% 白蒙层压住图片，文字取深色（最暗图上也 ≥5.6:1）
  overlayScrim: 'rgba(255, 255, 255, 0.82)',
  overlayInk: '#1E2A22',
  overlayInk2: '#3F4F45',
  overlayAccent: '#24543A'
};

/**
 * 深色令牌：纸底压到近黑，卡片抬一档；绿色保持同一色相但提亮，
 * `greenDeep` 同时用于主按钮底色和强调文字，取的中间值两头都能读。
 */
export const darkColors: ThemeColors = {
  paper: '#101413',
  card: '#1A201C',
  cardSoft: '#212823',
  ink: '#F2F4EF',
  ink2: '#B7C2B9',
  ink3: '#808C84',
  line: '#2E3731',
  green: '#6CBB8A',
  greenDeep: '#4E9469',
  greenSoft: '#182F22',
  greenTint: '#14281C',
  edgeGreen: '#2E5540',
  amber: '#D9A05B',
  amberSoft: '#33291A',
  edgeAmber: '#54402A',
  blue: '#7FA9D4',
  blueSoft: '#1B2A3A',
  blueInk: '#A8C8E8',
  edgeBlue: '#2B3F53',
  danger: '#E58A80',
  dangerSoft: '#2E1D1C',
  edgeDanger: '#5A3532',
  white: '#FFFFFF',
  backdrop: 'rgba(0, 0, 0, 0.6)',
  // 深色模式用 74% 近黑蒙层，文字取浅色（最亮图上最差也有 ≈5.2:1）
  overlayScrim: 'rgba(12, 16, 14, 0.74)',
  overlayInk: '#F2F4EF',
  overlayInk2: '#CBD5CD',
  overlayAccent: '#9BD9B0'
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

/** 卡片统一投影：浅色用轻投影，深色靠更重的黑投影把卡片从纸底上抬起来 */
function cardShadow(name: ThemeName) {
  return {
    shadowColor: name === 'dark' ? '#000000' : lightColors.ink,
    shadowOpacity: name === 'dark' ? 0.45 : 0.06,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2
  };
}

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

export type ThemeName = 'light' | 'dark';

export interface Theme {
  /** 实际生效的明暗，已解析过「跟随系统」 */
  name: ThemeName;
  isDark: boolean;
  colors: ThemeColors;
  /** 卡片投影，直接展开到 StyleSheet 里用 */
  shadow: ReturnType<typeof cardShadow>;
}

export function buildTheme(name: ThemeName): Theme {
  return {
    name,
    isDark: name === 'dark',
    colors: name === 'dark' ? darkColors : lightColors,
    shadow: cardShadow(name)
  };
}
