/**
 * 分组列表（iOS `insetGrouped` 的形态）。
 *
 * ## 为什么要自己拼
 *
 * Lody 用原生 `UICollectionViewCompositionalLayout.list(appearance: .insetGrouped)`，
 * 那是真正的系统列表。我们目前没有那个原生模块（`memoh-kit` 只承接消息列表），
 * 所以在 RN 侧拼一个**形状上等价**的版本：一张圆角卡片里若干行，行间发丝线且
 * 左缩进对齐文字起点，卡片之间有 24pt 间距。
 *
 * 这是有意的取舍：拼出来的版本在交互细节上（滑动操作、列表选中态的转场行为）
 * 不如原生的，但形状、间距、分隔线缩进这些"看起来像不像 iOS"的部分是一致的。
 * 真正需要原生行为时应该像 Lody 那样补一个原生列表模块，而不是继续在 RN 里加戏。
 *
 * ## 三个容易做错的细节
 *
 * 1. **分隔线左缩进对齐文字起点，不是通栏。** 通栏是 Web 表格的习惯。
 * 2. **首尾行要圆角**，中间行不能圆——否则卡片中间会出现圆弧。
 *    RN 的 overflow:hidden 能兜住，但按住高亮时的背景色仍会溢出直角，
 *    所以这里显式给首尾行圆角。
 * 3. **行高下限 44pt。** 低于它是错的（触控目标）。
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  GROUP_INSET,
  MIN_TOUCH_TARGET,
  ROW_SEPARATOR_INSET,
  radius,
  radiusStyle,
  spacing,
  typography,
} from '../lib/theme/tokens.ts';
import { usePalette, useTheme } from '../lib/theme/context.tsx';

export interface GroupProps {
  /** 分组标题（小写字母开头的说明性文字，iOS 用的是普通大小写而非全大写）。 */
  header?: string;
  /** 分组脚注。iOS 用它放说明或错误。 */
  footer?: string;
  children: React.ReactNode;
}

/**
 * 一个分组卡片。
 *
 * `header` / `footer` 用 `secondaryLabel` 的 footnote——iOS 的分组头就是这个
 * 视觉重量。别用全大写或加粗，那会让它和内容抢注意力。
 */
export function Group({ header, footer, children }: GroupProps) {
  const palette = usePalette();
  const { spacing: space } = useTheme();

  return (
    <View style={{ marginBottom: space.xxl }}>
      {header !== undefined ? (
        <Text
          style={[
            typography.footnote,
            {
              color: palette.secondaryLabel,
              marginBottom: space.sm,
              paddingHorizontal: spacing.xs,
            },
          ]}
        >
          {header}
        </Text>
      ) : null}
      <View style={[{ backgroundColor: palette.card, overflow: 'hidden' }, radiusStyle(radius.md)]}>
        {children}
      </View>
      {footer !== undefined ? (
        <Text
          style={[
            typography.footnote,
            {
              color: palette.secondaryLabel,
              marginTop: space.sm,
              paddingHorizontal: spacing.xs,
            },
          ]}
        >
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export interface RowProps {
  title: string;
  /** 副标题（第二行）。 */
  subtitle?: string;
  /** 左侧图标（SF Symbol 名，由原生渲染；不可用时传 undefined）。 */
  icon?: React.ReactNode;
  /** 图标底色。iOS 设置里图标有彩色底块，这里用色块而不是裸图标。 */
  iconTint?: string;
  /** 右侧值文字（如版本号、服务器地址）。 */
  value?: string;
  /** 危险操作（退出登录）。文字变红。 */
  destructive?: boolean;
  /** 显示右箭头表示可进入下一层。 */
  disclosure?: boolean;
  /** 显示选中勾。 */
  selected?: boolean;
  /** 是否是分组最后一行（决定要不要画分隔线、要不要圆角）。 */
  last?: boolean;
  onPress?: () => void;
  /** 右侧自定义内容（开关、自定义视图）。给了它就不显示 value/chevron。 */
  accessory?: React.ReactNode;
  /** 无障碍标签补充。 */
  accessibilityHint?: string;
}

/**
 * 一行。
 *
 * 布局从左到右：图标 → 文字块（标题 + 可选副标题）→ 右侧（值 / 勾 / 箭头）。
 * 这是 iOS 设置页的标准形态，几乎所有"可进入的设置项"都长这样。
 */
export function Row({
  title,
  subtitle,
  icon,
  iconTint,
  value,
  destructive = false,
  disclosure = false,
  selected = false,
  last = false,
  onPress,
  accessory,
  accessibilityHint,
}: RowProps) {
  const palette = usePalette();
  const { spacing: space } = useTheme();

  const titleColor = destructive ? palette.destructive : palette.label;
  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: MIN_TOUCH_TARGET,
        paddingVertical: 10,
        paddingHorizontal: GROUP_INSET,
      }}
    >
      {icon !== undefined ? (
        <View
          style={{
            width: 29,
            height: 29,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: iconTint ?? 'transparent',
            ...radiusStyle(7),
          }}
        >
          {icon}
        </View>
      ) : null}

      <View style={{ flex: 1, gap: 1 }}>
        <Text style={[typography.body, { color: titleColor }]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text style={[typography.footnote, { color: palette.secondaryLabel }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {accessory ?? (
        <>
          {value !== undefined ? (
            <Text style={[typography.body, { color: palette.secondaryLabel }]} numberOfLines={1}>
              {value}
            </Text>
          ) : null}
          {selected ? <Text style={[typography.body, { color: palette.accent }]}>✓</Text> : null}
          {disclosure ? (
            <Text style={[typography.body, { color: palette.tertiaryLabel }]}>›</Text>
          ) : null}
        </>
      )}

      {/* 分隔线：左缩进对齐文字起点，不通栏。 */}
      {!last ? (
        <View
          style={{
            position: 'absolute',
            left: icon !== undefined ? ROW_SEPARATOR_INSET : GROUP_INSET,
            right: 0,
            bottom: 0,
            height: StyleSheet.hairlineWidth,
            backgroundColor: palette.separator,
          }}
        />
      ) : null}
    </View>
  );

  if (onPress === undefined) return content;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? palette.field : 'transparent',
      })}
    >
      {content}
    </Pressable>
  );
}
