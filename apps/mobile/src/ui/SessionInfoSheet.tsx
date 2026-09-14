/**
 * 会话信息面板（对应桌面端的 session-info panel）。
 *
 * ## 它回答什么
 *
 * "这个会话到哪儿了"：消息数、上下文用了多少、cache 命中了多少。桌面端把这些
 * 放在导航栏的一个环里，点开是面板；移动端按设计基线做在**聊天头部**（标题可点）。
 *
 * ## 一条硬规则：不编数
 *
 * 这台部署的服务端**不给上下文窗口**（实测 `GET …/status` 只回 `used_tokens`，
 * 模型配置里也没有 `context_window`）。所以这里**不显示百分比**——没有分母的
 * 百分比是编出来的，而它恰恰会被当成"还有多少余量"的决策依据。
 *
 * 有窗口时（上游较新的部署会给）自动显示进度条与百分比；没窗口时只报绝对值，
 * 并在页脚说明为什么没有比例。宁可少显示一格，也不要给一个假的分母。
 *
 * ## 为什么用系统分组行
 *
 * 形态照 iOS 设置页：`GroupedList` 的分组卡片 + 发丝线。AGENTS.md 要求"系统有
 * 现成的就用现成的"，而且这类"读数值"的界面本来就不该有自绘的图表腔调。
 */
import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SessionStatus } from '../models/chat.ts';
import {
  formatPercent,
  formatTokenCount,
  sessionInfoView,
  type SessionInfoView,
} from '../features/session/sessionInfo.ts';
import { Group, Row } from './GroupedList.tsx';
import { useT } from '../lib/i18n/useT.ts';
import { usePalette, useTheme } from '../lib/theme/context.tsx';

export function SessionInfoSheet({
  visible,
  status,
  loading,
  error,
  onClose,
}: {
  visible: boolean;
  status: SessionStatus | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const palette = usePalette();
  const { spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const t = useT();

  /**
   * 内容区能用多高。
   *
   * 必须**按可用空间算**而不是写死一个数：写死的话（之前是 460）在窗口给到
   * `context_window` 时行数变多，最后一行会被弹窗边缘从中间裁掉——看起来像坏了，
   * 而用户未必知道能滚。按屏高算之后，常见内容一屏放得下，真的更长才进入滚动。
   */
  const contentMaxHeight = Math.max(240, windowHeight * 0.85 - (insets.bottom + 120));

  if (!visible) return null;
  const view = sessionInfoView(status);
  const hasAny = status !== null;

  return (
    <Modal visible transparent animationType="slide" presentationStyle="overFullScreen">
      <View style={[styles.backdrop, { backgroundColor: palette.overlay }]}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: palette.card,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              paddingBottom: insets.bottom + spacing.lg,
              paddingTop: spacing.lg,
            },
          ]}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: spacing.lg,
              gap: spacing.sm,
            }}
          >
            <Text style={[typography.title3, { color: palette.label, flex: 1 }]}>
              {t('sessionInfo.title')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={onClose}
              hitSlop={12}
              style={{
                minWidth: 44,
                minHeight: 44,
                alignItems: 'flex-end',
                justifyContent: 'center',
              }}
            >
              <Text style={[typography.body, { color: palette.accent }]}>{t('common.close')}</Text>
            </Pressable>
          </View>

          <ScrollView
            style={{ maxHeight: contentMaxHeight }}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}
          >
            {error !== null ? (
              <Text style={[typography.footnote, { color: palette.destructive }]}>{error}</Text>
            ) : null}

            {!hasAny && loading ? (
              <Text style={[typography.footnote, { color: palette.secondaryLabel }]}>
                {t('sessionInfo.loading')}
              </Text>
            ) : null}

            {hasAny ? (
              <Group header={t('sessionInfo.group.context')}>
                {/* 有窗口才有比例。没有分母时这一行不出现——不是显示 0%。 */}
                {view.contextPercent !== null ? <ContextBar view={view} /> : null}
                <Row
                  title={t('sessionInfo.usedTokens')}
                  value={formatTokenCount(view.usedTokens)}
                  last={view.contextWindow === null}
                />
                {view.contextWindow !== null ? (
                  <Row
                    title={t('sessionInfo.window')}
                    value={formatTokenCount(view.contextWindow)}
                    last={view.autoCompactTokens === null}
                  />
                ) : null}
                {view.autoCompactTokens !== null ? (
                  <Row
                    title={t('sessionInfo.autoCompact')}
                    value={formatTokenCount(view.autoCompactTokens)}
                    last
                  />
                ) : null}
              </Group>
            ) : null}

            {hasAny ? (
              <Group
                header={t('sessionInfo.group.session')}
                footer={view.contextWindow === null ? t('sessionInfo.noWindowFooter') : undefined}
              >
                <Row
                  title={t('sessionInfo.messages')}
                  value={formatTokenCount(view.messageCount)}
                  last
                />
              </Group>
            ) : null}

            {hasAny ? (
              <Group header={t('sessionInfo.group.cache')}>
                <Row title={t('sessionInfo.hitRate')} value={formatPercent(view.cacheHitRate)} />
                <Row
                  title={t('sessionInfo.cacheRead')}
                  value={formatTokenCount(view.cacheReadTokens)}
                />
                <Row
                  title={t('sessionInfo.input')}
                  value={formatTokenCount(view.totalInputTokens)}
                  last
                />
              </Group>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * 上下文用量条。
 *
 * 只在**有窗口**时渲染（调用点已经保证）。轨道用系统分组底色、进度用品牌色：
 * 这是"用量"不是"警告"，不到阈值不用红黄——上游也是这个态度。
 */
function ContextBar({ view }: { view: SessionInfoView }) {
  const palette = usePalette();
  const { spacing, radius, typography } = useTheme();
  const t = useT();
  const percent = view.contextPercent ?? 0;

  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={[typography.subhead, { color: palette.label, flex: 1 }]}>
          {t('sessionInfo.contextUsage')}
        </Text>
        <Text style={[typography.subhead, { color: palette.secondaryLabel }]}>
          {formatPercent(percent)}
        </Text>
      </View>
      <View
        style={{
          height: 6,
          marginTop: spacing.sm,
          borderRadius: radius.sm,
          backgroundColor: palette.field,
          overflow: 'hidden',
        }}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }}
      >
        <View
          style={{
            width: `${percent}%`,
            height: '100%',
            backgroundColor: palette.accent,
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%' },
});
