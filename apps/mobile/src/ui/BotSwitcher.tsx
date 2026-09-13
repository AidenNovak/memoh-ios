/**
 * Bot（agent）切换器。
 *
 * Memoh 是"多 bot"的：一个用户可以有好几个 agent，各自有自己的云电脑和记忆。
 * 所以在列表页顶部需要一个轻量的切换入口。用原生 ActionSheet 语义（底部弹出），
 * 而不是自己画一个下拉菜单。
 */
import React, { useCallback, useState } from 'react';
import { ActionSheetIOS, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useT } from '../lib/i18n/useT.ts';
import { usePalette, useTheme } from '../lib/theme/context.tsx';
import { useSession } from '../features/session/store.tsx';

export function BotSwitcher() {
  const palette = usePalette();
  const { spacing, typography, radius } = useTheme();
  const t = useT();
  const { state, currentBot, selectBot } = useSession();
  const [busy, setBusy] = useState(false);

  const open = useCallback(() => {
    const botList = state.bots;
    if (botList.length === 0) return;

    if (Platform.OS === 'ios') {
      const labels = botList.map((bot) => (bot.display_name !== '' ? bot.display_name : bot.name));
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t('home.bot.switch'),
          options: [...labels, t('common.cancel')],
          cancelButtonIndex: labels.length,
        },
        (index) => {
          const chosen = botList[index];
          if (chosen !== undefined) selectBot(chosen.id);
        },
      );
      return;
    }

    // 非 iOS 平台理论上不会跑到（本项目只做 iOS），留一个不崩的退路。
    setBusy(true);
    const next =
      botList[(botList.findIndex((bot) => bot.id === currentBot?.id) + 1) % botList.length];
    if (next !== undefined) selectBot(next.id);
    setBusy(false);
  }, [currentBot?.id, selectBot, state.bots, t]);

  const title =
    currentBot === null
      ? t('home.empty.title')
      : currentBot.display_name !== ''
        ? currentBot.display_name
        : currentBot.name;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('home.bot.switch')}
      disabled={state.bots.length === 0 || busy}
      onPress={open}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: pressed ? palette.field : palette.card,
          borderRadius: radius.pill,
          marginHorizontal: spacing.lg,
          marginBottom: spacing.sm,
          paddingHorizontal: spacing.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.separator,
        },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor:
              currentBot?.is_active === true ? palette.success : palette.tertiaryLabel,
          }}
        />
        <Text style={[typography.callout, { color: palette.label }]} numberOfLines={1}>
          {title}
        </Text>
        {state.bots.length > 1 ? (
          <Text style={[typography.footnote, { color: palette.tertiaryLabel }]}>⌄</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 36,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingVertical: 6,
  },
});
