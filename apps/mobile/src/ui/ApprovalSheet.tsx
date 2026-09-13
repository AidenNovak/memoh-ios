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
              <Text style={[typography.footnote, { color: palette.tertiaryLabel }]}>
                {t('chat.tool')}
              </Text>
              <Text style={[typography.callout, { color: palette.label, marginTop: 2 }]}>
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

  // agent 给了名字就用它的；没有就用本地化兜底文案（按语气选）。
  const label =
    choice.label !== undefined && choice.label !== '' ? choice.label : t(fallbackLabelKey(choice));

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

/** 工具入参的展示。太长就截断——手机上没人读一千行 JSON。 */
function formatInput(input: unknown): string {
  try {
    const text = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
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
