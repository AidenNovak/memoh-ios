/**
 * Debug 页（仅开发）。
 *
 * 验收场景的宿主：故障注入、连接状态、以及"不登录也能跑 UI 检查"的入口。
 * 产品屏幕上只暴露可操作的状态，内部细节都收在这里。
 *
 * 参考项目把 Fault injection / runtime internals / Router 演示都放在这一页，
 * 理由是一样的：让验收场景能用**生产组件**，但只在 Debug 里可达。
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePalette, useTheme } from '../lib/theme/context.tsx';

export function DebugScreen() {
  const palette = usePalette();
  const { spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.groupedBackground }}
      contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.lg }}
    >
      <Text style={[typography.title2, { color: palette.label, marginBottom: spacing.md }]}>
        Debug
      </Text>
      <Text
        style={[typography.footnote, { color: palette.secondaryLabel, marginBottom: spacing.lg }]}
      >
        只有开发构建里可达。验收场景在这里挂载，用生产组件 + 确定性数据。
      </Text>

      <View
        style={{
          backgroundColor: palette.card,
          borderRadius: 10,
          padding: spacing.md,
          gap: spacing.sm,
        }}
      >
        <Text style={[typography.subhead, { color: palette.label }]}>待补的场景</Text>
        <Text style={[typography.footnote, { color: palette.secondaryLabel }]}>
          · chat-streaming —— 固定一份 append 序列，验证流式渲染不跳动{'\n'}· approval-sheet —— 三种
          option 语气（allow / reject / neutral）{'\n'}· connection-gap —— 注入 epoch
          变化，验证"刷新中"提示
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({});
