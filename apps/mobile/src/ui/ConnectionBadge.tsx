/**
 * 连接状态指示。
 *
 * 移动网络下"连不上"是常态而不是异常，所以它必须是**可操作的**而不是一个红点：
 * 断了就说断了，重连中就说重连中，视图可能过期时提示正在刷新。
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
  const { spacing, typography } = useTheme();
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
  const label =
    connection === 'open'
      ? t('bot.status.online')
      : connection === 'connecting' || connection === 'reconnecting'
        ? t('chat.reconnecting')
        : t('chat.disconnected');

  const color = connection === 'open' ? palette.success : palette.warning;

  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: color }]} />
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
