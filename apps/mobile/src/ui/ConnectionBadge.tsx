/**
 * 连接状态指示。
 *
 * ## 只在**不正常**的时候出现
 *
 * 移动网络下"连不上"是常态而不是异常，所以它必须是**可操作的**而不是一个红点：
 * 断了就说断了，重连中就说重连中。
 *
 * 但**连上了就不说话**。之前它在正常连接时也会显示一个绿点加 "Online"，
 * 而顶部的 bot 切换器上已经有一个绿点（那是 bot 的 `is_active`）——两个绿点、
 * 两种含义并排，视觉评审一眼就问"哪个才是在线"。
 *
 * iOS 的惯例是：正常状态不需要被宣布（系统不会告诉你"电量正常"）。
 * 所以这里只在连接有问题时渲染。
 *
 * 不做的事：不自己偷偷重试后假装没事。用户需要知道屏幕上看到的是不是最新的。
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useT } from '../lib/i18n/useT.ts';
import { usePalette, useTheme } from '../lib/theme/context.tsx';
import { useSession } from '../features/session/store.tsx';

export function ConnectionBadge() {
  const palette = usePalette();
  const { typography } = useTheme();
  const t = useT();
  const { state, realtimeEnabled } = useSession();

  if (!realtimeEnabled) {
    return (
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: palette.tertiaryLabel }]} />
        <Text style={[typography.caption, { color: palette.tertiaryLabel }]}>
          {t('chat.disconnected')}
        </Text>
      </View>
    );
  }

  const { connection } = state;
  // 连着的时候不渲染——正常状态不需要占位置。
  if (connection === 'open') return null;

  const label =
    connection === 'connecting' || connection === 'reconnecting'
      ? t('chat.reconnecting')
      : t('chat.disconnected');

  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: palette.warning }]} />
      <Text style={[typography.caption, { color: palette.secondaryLabel }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
