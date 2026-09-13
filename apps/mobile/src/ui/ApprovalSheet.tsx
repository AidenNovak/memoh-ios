/**
 * 工具审批面板。
 *
 * 这是移动端最重要的一个界面。三条硬要求：
 *
 * 1. **渲染 agent 给的 options，不写死两个按钮。** agent 自己定义权限选项
 *    （`allow_once` / `allow_always` / `reject_once` / `reject_always`），没有它们
 *    用户永远选不到 session / always 作用域。
 *
 * 2. **不可跳过。** run 停在 `waiting_decision` 上，不回应就永远不继续。所以这是
 *    一个 sheet，不是一条可忽略的提示。
 *
 * 3. **展示足够判断的信息**：哪个工具、要做什么。用户在外面用手机点"允许"，必须
 *    能看清自己批准的是什么。
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ApprovalChoice, PendingApproval } from '../models/chat.ts';
import { fallbackLabelKey } from '../features/chat/reducer.ts';
import { useT } from '../lib/i18n/useT.ts';
import { usePalette, useTheme } from '../lib/theme/context.tsx';

export function ApprovalSheet({
  approval,
  onChoose,
}: {
  approval: PendingApproval | null;
  onChoose: (optionId: string) => void;
}) {
  const palette = usePalette();
  const { spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();

  if (approval === null) return null;

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
          <Text
            style={[typography.title3, { color: palette.label, paddingHorizontal: spacing.lg }]}
          >
            {t('approval.title')}
          </Text>
          <Text
            style={[
              typography.subhead,
              {
                color: palette.secondaryLabel,
                paddingHorizontal: spacing.lg,
                marginTop: spacing.xs,
              },
            ]}
          >
            {t('approval.subtitle')}
          </Text>

          {approval.toolName !== '' ? (
            <View
              style={{
                marginHorizontal: spacing.lg,
                marginTop: spacing.md,
                padding: spacing.md,
                backgroundColor: palette.groupedBackground,
                borderRadius: radius.md,
              }}
            >
              {/* 工具名和入参同处一个块，不再给"Tool"单开一行小标题：
                  它只是把下面那行内容又标了一遍，多一层却没有多一个信息。
                  消息流里那张卡片能显示同样内容，这里是给"没看见卡片"的情况兜底。 */}
              <Text style={[typography.callout, { color: palette.label }]}>
                {approval.toolName}
              </Text>
              {approval.toolInput !== undefined ? (
                <ScrollView style={{ maxHeight: 160, marginTop: spacing.sm }}>
                  <Text style={[typography.mono, { color: palette.secondaryLabel }]}>
                    {formatInput(approval.toolInput)}
                  </Text>
                </ScrollView>
              ) : null}
            </View>
          ) : null}

          <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg, gap: spacing.sm }}>
            {approval.options.map((option) => (
              <ChoiceButton key={option.id} choice={option} onPress={() => onChoose(option.id)} />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ChoiceButton({ choice, onPress }: { choice: ApprovalChoice; onPress: () => void }) {
  const palette = usePalette();
  const { spacing, radius, typography } = useTheme();
  const t = useT();

  /**
   * 文案来源有三层，优先级从高到低：
   *   1. agent 给的名字（它最清楚这个动作的含义）
   *   2. 我们的兜底动作（`__fallback_*`）——它的 label 存的是 i18n key
   *   3. 按语气猜一个通用文案
   *
   * 第 2 层必须走 i18n：兜底动作是我们造出来的，agent 不可能给它命名。
   */
  let label: string;
  if (choice.label !== undefined && choice.label !== '') {
    label = choice.label.startsWith('approval.') ? t(choice.label) : choice.label;
  } else {
    label = t(fallbackLabelKey(choice));
  }

  const tone =
    choice.tone === 'allow'
      ? { background: palette.accent, color: '#FFFFFF' }
      : choice.tone === 'reject'
        ? { background: palette.field, color: palette.destructive }
        : { background: palette.card, color: palette.label };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: tone.background,
          borderRadius: radius.md,
          paddingVertical: spacing.md,
          opacity: pressed ? 0.85 : 1,
          borderWidth: choice.tone === 'neutral' ? StyleSheet.hairlineWidth : 0,
          borderColor: palette.separator,
        },
      ]}
    >
      <Text style={[typography.headline, { color: tone.color }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * 工具入参的展示。
 *
 * 与原生消息卡片的入参摘要保持同一套规则（见 `modules/memoh-kit/ios/Chat/Transcript.swift`
 * 的 `ToolInput.preview`）：**扁平对象渲染成 `key: value` 每行一条，不吐 JSON 语法**。
 * 同一个屏幕上两处显示同一份入参却格式不一致，用户会以为看的是两件不同的事。
 *
 * 嵌套或数组退回 JSON——那种情况不多，也不该由半吊子的人肉格式化去猜。
 */
function formatInput(input: unknown): string {
  const LIMIT = 2000;
  const clip = (text: string) => (text.length > LIMIT ? `${text.slice(0, LIMIT)}…` : text);
  try {
    if (typeof input === 'string') return clip(input);

    if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
      const entries = Object.entries(input as Record<string, unknown>);
      const allScalar = entries.every(
        ([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value),
      );
      if (allScalar && entries.length > 0) {
        return clip(
          [...entries]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}: ${value === null ? '' : String(value)}`)
            .join('\n'),
        );
      }
    }

    return clip(JSON.stringify(input, null, 2));
  } catch {
    return String(input);
  }
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '80%',
  },
  choice: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
