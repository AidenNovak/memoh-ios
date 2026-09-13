/**
 * 主题底座。
 *
 * ## 设计来源
 *
 * 这一版按 `docs/research/lody-design-spec.md`（一个成熟 iOS AI 客户端的设计系统）
 * 重写。三条原则：
 *
 * 1. **用 iOS 语义色，不用 Web 的 hex。** Web 那套 token 是给浏览器和
 *    Inter/MiSans 调的；搬到 iOS 上会显得"不是原生"。系统语义色自带明暗切换、
 *    对比度适配、无障碍反转。
 *
 * 2. **少而明确的角色，而不是一堆字号。** Lody 全部排版只有六个角色
 *    （title / body / secondary / meta / eyebrow / mono），业务代码不出现裸字号。
 *    角色越少，界面越一致——"每个页面看起来是同一个 App"就是这么来的。
 *
 * 3. **行高必须显式给。** iOS 系统行高比 `fontSize * 1.2` 宽（正文 17pt 配 25pt
 *    行高）。不给行高，密集段落会挤在一起，这是"看起来业余"最常见的原因之一。
 *
 * ## 与 Lody 的差异（有意为之）
 *
 * - **保留 Memoh 的紫色强调**，不换成 Lody 的靛蓝——用户在 Web 端认得这个颜色。
 *   但**取了一个更深的值**：原来的 `#7C5CFF` 在浅色下对白底只有 4.35:1、
 *   对分组底 3.89:1，都不满足 4.5:1。现在是 `#6B4AE8`（5.57 / 4.99）。
 *   `theme_test.mjs` 会守住这条，别再改回去。
 * - **深色背景默认纯黑**（Lody 默认 `#111113` 柔和黑）。这是自托管产品的选择：
 *   省电、对比强，且 `oled` 模式本来就是我们的一个显式选项。
 */
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
  /**
   * 阅读面（对话页、消息流）的背景。
   *
   * 和 `background` 分开是有原因的：分组列表要 `#F2F2F7` 才能让白卡片浮起来，
   * 而消息流是**连续阅读**，白底更安静。深色下两者相同。
   */
  reading: string;
  /** 主文本。 */
  label: string;
  /** 次要文本（副标题、说明、时间）。 */
  secondaryLabel: string;
  /** 三级文本（装饰性，不承载必要信息）。 */
  tertiaryLabel: string;
  /** 占位文本。 */
  placeholder: string;
  /** 分隔线。 */
  separator: string;
  /** 动作强调色。**唯一非系统色**。 */
  accent: string;
  /**
   * 强调色上的文字色。
   *
   * 单独给一个角色而不是到处写 `#FFFFFF`：强调色一旦换成浅色（比如深色模式的
   * 淡紫），白字就不可读了。让"压在强调色上的文字"永远从这一处取。
   */
  onAccent: string;
  /** 危险动作 / 错误。 */
  destructive: string;
  /** 成功 / 在线。**只用于状态点，不用于文字**（对白底仅 2.2:1）。 */
  success: string;
  /** 警告。 */
  warning: string;
  /** 输入框背景。 */
  field: string;
  /**
   * 下沉面（chip、代码块、用户气泡底）。
   *
   * 语义是"比周围低一层"，与 `field` 的区别是它不承载输入。
   */
  inset: string;
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
  reading: '#FFFFFF',
  label: '#000000',
  secondaryLabel: '#3C3C4399',
  tertiaryLabel: '#3C3C434D',
  placeholder: '#3C3C434D',
  separator: '#3C3C4336',
  accent: '#6B4AE8',
  onAccent: '#FFFFFF',
  destructive: '#FF3B30',
  success: '#34C759',
  warning: '#FF9500',
  field: '#7676801F',
  inset: '#F5F5F5',
  overlay: '#00000066',
};

const dark: Palette = {
  background: '#000000',
  groupedBackground: '#000000',
  card: '#1C1C1E',
  reading: '#000000',
  label: '#FFFFFF',
  secondaryLabel: '#EBEBF599',
  tertiaryLabel: '#EBEBF54D',
  placeholder: '#EBEBF54D',
  separator: '#54545899',
  // 深色 accent：比原来的 #9C85FF 深一档。
  //
  // 原因是**白字压在强调色上**这件事。原来的值配白字只有 2.91:1，连"大字号
  // 3:1"都不到——而按钮文字正是压在强调色上的。现在 3.61:1，与 Apple 自己的
  // systemBlue 填色按钮（#0A84FF 配白字 = 3.65:1）齐平。
  //
  // 这是深色模式下强调色的固有张力：要够亮才在黑底上看得见，又要够暗才能压白字。
  // 取值为基色-亮度的折中，与系统同档。
  accent: '#8B72F5',
  onAccent: '#FFFFFF',
  destructive: '#FF453A',
  success: '#30D158',
  warning: '#FF9F0A',
  field: '#7676803D',
  inset: '#1C1C1E',
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

/**
 * 间距刻度。**只有这六档**。
 *
 * 看到需要 6、10、14、18 这类中间值时，通常说明该用另一档，而不是该加一档。
 * 加档会让间距体系失去约束，最后每个页面各有一套间距——那正是"不像一个 App"的来源。
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  /** 分区间距。 */
  xl: 20,
  /** 空态与大间距。 */
  xxl: 24,
} as const;

/** 分组列表的外边距（iOS `insetGrouped` 的系统值）。 */
export const GROUP_INSET = 16;

/**
 * 圆角。全部配 `borderCurve: 'continuous'`（见 `radiusStyle`）。
 *
 * 数值对齐 Lody 的那一套，因为它们是"看起来像 iOS"的一部分：
 * 系统连续圆角在同样半径下比普通圆角更饱满，观感差别明显。
 */
export const radius = {
  sm: 6,
  /** 附件、代码块等内嵌元素。 */
  md: 12,
  /** 面板、分组行（成组时首尾各圆一半）。 */
  lg: 18,
  /** 用户气泡。 */
  bubble: 19,
  /** 大卡片、分组容器。 */
  card: 26,
  /** 胶囊。 */
  pill: 999,
} as const;

/**
 * 连续圆角。RN 的 `borderRadius` 默认是普通圆角（CornerCurve = circular），
 * iOS 原生控件用的是连续圆角。这两个在同样半径下**观感不同**——连续圆角更饱满，
 * 是"原生感"的一部分。所有圆角都应该走这个 helper。
 */
export function radiusStyle(value: number) {
  return { borderRadius: value, borderCurve: 'continuous' as const };
}

/**
 * 排版角色。
 *
 * **六个核心角色**（对齐 Lody，业务代码优先用这些）：
 *   title    20/26 600  分区标题、页面标题
 *   body     17/25 400  正文、列表主标题、输入框
 *   secondary 15/21 400 副标题、说明
 *   meta     13/18 400  时间、状态、脚注
 *   eyebrow  11/14 600  全大写小标签
 *   mono     13/20 mono 路径、命令、ID、代码（**只有这四类**）
 *
 * 另有三个在 iOS 体系里必要的补充：`largeTitle`（登录页的品牌标题）、
 * `headline`（行主标题需要强调时）、`caption`（12pt，介于 meta 与 eyebrow）。
 *
 * 行高是显式给的，不是算出来的：iOS 系统行高比 `fontSize * 1.2` 宽，
 * 正文 17pt 配 25pt 行高。不给行高，多段文字会挤在一起。
 */
export const typography = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' as const, letterSpacing: 0.37 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, letterSpacing: 0.36 },
  /** `title` 角色：分区标题、页面标题。 */
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: 0.35 },
  title3: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const, letterSpacing: 0.38 },
  /** 行主标题需要强调时。 */
  headline: { fontSize: 17, lineHeight: 25, fontWeight: '600' as const, letterSpacing: -0.41 },
  /** `body` 角色：正文。 */
  body: { fontSize: 17, lineHeight: 25, fontWeight: '400' as const, letterSpacing: -0.41 },
  callout: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const, letterSpacing: -0.32 },
  /** `secondary` 角色：副标题、说明。 */
  subhead: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const, letterSpacing: -0.24 },
  /** `meta` 角色：时间、状态、脚注。 */
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const, letterSpacing: -0.08 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const, letterSpacing: 0 },
  /** `eyebrow` 角色：全大写小标签。配 `textTransform: 'uppercase'` 用。 */
  caption2: { fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 0.88 },
  /** `mono` 角色：路径、命令、ID、代码。只有这四类该用它。 */
  mono: { fontSize: 13, lineHeight: 20, fontWeight: '400' as const, fontFamily: 'Menlo' },
} as const;

/** 触控目标下限。低于这个值就是错的。 */
export const MIN_TOUCH_TARGET = 44;

/**
 * 分组列表的行内边距。
 *
 * 左边 16 是卡片内边距；有图标时图标占位 20 + 间距 12，文字起点因此落在 48。
 * 分隔线的左缩进要与文字起点对齐（而不是通栏），这是原生列表的标志性细节。
 */
export const ROW_PADDING = {
  top: 10,
  bottom: 10,
  leading: GROUP_INSET,
  trailing: GROUP_INSET,
} as const;
export const ROW_MIN_HEIGHT = 44;
/** 有图标时，分隔线应该从文字起点开始缩进。 */
export const ROW_SEPARATOR_INSET = 48;
