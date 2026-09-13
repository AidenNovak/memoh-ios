/**
 * 主题。
 *
 * 两条原则，来自 `docs/research/memoh-design-baseline.md`：
 *
 * 1. **用 iOS 语义色，不用 Web 的 hex。** Web 那套 token 是给浏览器和
 *    Inter/MiSans 调的；搬到 iOS 上会显得"不是原生"。系统语义色自带明暗切换、
 *    对比度适配、无障碍反转，这是免费得到的正确性。
 *
 * 2. **不要绿色强调色，不要装饰性阴影。** 动作用 system blue，其余用中性色。
 *    Web 用发丝线代替阴影，iOS 用 `separator` 与 grouped 背景做同样的事。
 *
 * 唯一的自定义色是 accent——Memoh Web 端用紫色，这里保留这个品牌线索，
 * 但只在"这是 Memoh 的东西"的地方（选择态、强调标记）出现，不铺满界面。
 */
import { useColorScheme } from 'react-native';

/** 主题模式：跟随系统 / 强制浅色 / 强制深色 / 深色下用纯黑。 */
export type AppearanceMode = 'system' | 'light' | 'dark' | 'oled';

/** RN 的 ColorSchemeName 含 'unspecified'，这里收敛成三态。 */
export type SystemScheme = 'light' | 'dark' | null | undefined;

export interface Palette {
  /** 页面背景（分组列表的底）。 */
  background: string;
  /** 分组容器的背景。 */
  groupedBackground: string;
  /** 卡片/行的背景。 */
  card: string;
  /** 主文本。 */
  label: string;
  /** 次要文本。 */
  secondaryLabel: string;
  /** 三级文本（时间戳、脚注）。 */
  tertiaryLabel: string;
  /** 占位文本。 */
  placeholder: string;
  /** 分隔线。 */
  separator: string;
  /** 动作强调色。 */
  accent: string;
  /** 危险动作。 */
  destructive: string;
  /** 成功/在线状态。 */
  success: string;
  /** 警告。 */
  warning: string;
  /** 输入框背景。 */
  field: string;
  /** 覆盖层（sheet 后面的遮罩）。 */
  overlay: string;
}

/**
 * iOS 语义色的实际取值。
 *
 * 这些与 `UIColor.systemBackground` 等一致。写死是因为 RN 的 `PlatformColor`
 * 在动画与插值场景里行为不一致，而在浅/深两档下单值就够了——真需要系统动态色
 * 时用 `PlatformColor`。
 */
const light: Palette = {
  background: '#FFFFFF',
  groupedBackground: '#F2F2F7',
  card: '#FFFFFF',
  label: '#000000',
  secondaryLabel: '#3C3C4399',
  tertiaryLabel: '#3C3C434D',
  placeholder: '#3C3C434D',
  separator: '#3C3C4336',
  accent: '#7C5CFF',
  destructive: '#FF3B30',
  success: '#34C759',
  warning: '#FF9500',
  field: '#7676801F',
  overlay: '#00000066',
};

const dark: Palette = {
  background: '#000000',
  groupedBackground: '#000000',
  card: '#1C1C1E',
  label: '#FFFFFF',
  secondaryLabel: '#EBEBF599',
  tertiaryLabel: '#EBEBF54D',
  placeholder: '#EBEBF54D',
  separator: '#54545899',
  accent: '#9C85FF',
  destructive: '#FF453A',
  success: '#30D158',
  warning: '#FF9F0A',
  field: '#7676803D',
  overlay: '#00000099',
};

/**
 * 真黑模式：深色下的背景用纯黑。
 *
 * 这是设计基线里明确要的一个设置项——纯黑省电，但看久了累，所以由用户决定，
 * 不替他们决定。
 */
const oled: Palette = {
  ...dark,
  card: '#0A0A0A',
  groupedBackground: '#000000',
};

export function paletteFor(mode: AppearanceMode, systemScheme: SystemScheme): Palette {
  if (mode === 'oled') return oled;
  return resolvedScheme(mode, systemScheme) === 'dark' ? dark : light;
}

/** 解析后的实际明暗，用于状态栏和原生控件。 */
export function resolvedScheme(mode: AppearanceMode, systemScheme: SystemScheme): 'light' | 'dark' {
  if (mode === 'system') return systemScheme === 'dark' ? 'dark' : 'light';
  if (mode === 'light') return 'light';
  return 'dark';
}

/** 间距刻度。iOS 惯用值。 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** 圆角。iOS 上比 Web 更克制：卡片 10，气泡 18。 */
export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  bubble: 18,
  pill: 999,
} as const;

/** 字体层级。字号用系统 Dynamic Type 的基准值。 */
export const typography = {
  largeTitle: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.37 },
  title1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: 0.36 },
  title2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: 0.35 },
  title3: { fontSize: 20, fontWeight: '600' as const, letterSpacing: 0.38 },
  headline: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.41 },
  body: { fontSize: 17, fontWeight: '400' as const, letterSpacing: -0.41 },
  callout: { fontSize: 16, fontWeight: '400' as const, letterSpacing: -0.32 },
  subhead: { fontSize: 15, fontWeight: '400' as const, letterSpacing: -0.24 },
  footnote: { fontSize: 13, fontWeight: '400' as const, letterSpacing: -0.08 },
  caption: { fontSize: 12, fontWeight: '400' as const, letterSpacing: 0 },
  caption2: { fontSize: 11, fontWeight: '400' as const, letterSpacing: 0.07 },
  mono: { fontSize: 13, fontWeight: '400' as const, fontFamily: 'Menlo' },
} as const;

/** 触控目标下限。低于这个值就是错的。 */
export const MIN_TOUCH_TARGET = 44;

/** 读取系统明暗。用 RN 的 hook，因为主题本身就在这一层。 */
export function useSystemScheme(): 'light' | 'dark' {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}
