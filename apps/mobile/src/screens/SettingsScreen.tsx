/**
 * 设置页。
 *
 * 只放手机上真有意义的设置。Memoh Web 端有十几个配置页（providers、memory、voice、
 * video、email…），那些都是"坐在电脑前配置一次"的东西，搬到手机上每个都会变成
 * 一堆难用的表单。这里保留的是：账号、外观、语言、以及一个进 Debug 的入口。
 *
 * ## 形态
 *
 * 用 `GroupedList`（inset 分组卡片 + 发丝线左缩进 + 44pt 行高）。页面里**没有
 * 自绘的标题栏**——标题是滚动内容的第一行，`‹` 返回放在它旁边。
 *
 * 为什么不用原生导航栏：这个项目的路由是全 RN 的（`headerShown: false`），
 * 原生导航栏需要另一套 bridge。自绘的代价是转场时标题不会跟随系统动画，
 * 收益是这一屏的形状、间距、分组全部可控。等哪天补了原生导航模块再换。
 */
import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AppearanceMode } from '../lib/theme/index.ts';
import { clearSession } from '../api/credentials.ts';
import {
  getLocale,
  localeDisplayName,
  setLocale,
  SUPPORTED_LOCALES,
  type Locale,
} from '../lib/i18n/index.ts';
import { useT } from '../lib/i18n/useT.ts';
import { useLocale } from '../lib/i18n/useLocale.ts';
import { GROUP_INSET, MIN_TOUCH_TARGET, spacing, typography } from '../lib/theme/tokens.ts';
import { usePalette, useTheme } from '../lib/theme/context.tsx';
import { useSession } from '../features/session/store.tsx';
import { Group, Row } from '../ui/GroupedList.tsx';

const APPEARANCE_MODES: AppearanceMode[] = ['system', 'light', 'dark', 'oled'];
const APPEARANCE_KEY: Record<AppearanceMode, string> = {
  system: 'settings.appearance.system',
  light: 'settings.appearance.light',
  dark: 'settings.appearance.dark',
  oled: 'settings.appearance.oled',
};

export function SettingsScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { state, currentBot, signOut } = useSession();
  const { mode, setMode } = useTheme();

  const botName =
    currentBot?.display_name !== '' && currentBot?.display_name !== undefined
      ? currentBot.display_name
      : (currentBot?.name ?? '');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.groupedBackground }}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.sm,
        paddingBottom: insets.bottom + spacing.xxl,
        paddingHorizontal: GROUP_INSET,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          minHeight: MIN_TOUCH_TARGET,
          marginBottom: spacing.lg,
        }}
      >
        <Text
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => router.back()}
          style={[typography.body, { color: palette.accent }]}
        >
          ‹
        </Text>
        <Text style={[typography.title2, { color: palette.label }]}>{t('settings.title')}</Text>
      </View>

      <Group header={t('settings.account')}>
        <Row
          title={t('settings.account')}
          value={botName}
          subtitle={state.client?.url ?? ''}
          last
        />
      </Group>

      <Group
        header={t('settings.appearance')}
        footer={mode === 'oled' ? t('settings.appearance.oled.footer') : undefined}
      >
        {APPEARANCE_MODES.map((option, index) => (
          <Row
            key={option}
            title={t(APPEARANCE_KEY[option])}
            selected={mode === option}
            last={index === APPEARANCE_MODES.length - 1}
            onPress={() => setMode(option)}
          />
        ))}
      </Group>

      <Group header={t('settings.language')}>
        {SUPPORTED_LOCALES.map((option: Locale, index) => (
          <Row
            key={option}
            title={localeDisplayName(option)}
            selected={getLocale() === option}
            last={index === SUPPORTED_LOCALES.length - 1}
            onPress={() => setLocale(option)}
          />
        ))}
      </Group>

      <Group>
        <Row
          title={t('settings.signOut')}
          destructive
          last
          onPress={() => {
            void clearSession().then(() => {
              signOut();
              router.replace('/');
            });
          }}
        />
      </Group>

      {__DEV__ ? (
        <Group header="Debug">
          <Row
            title="Scenes"
            subtitle="固定场景截图"
            disclosure
            onPress={() => router.push('/debug/scene')}
          />
          <Row title="Debug" last disclosure onPress={() => router.push('/debug')} />
        </Group>
      ) : null}

      <Text
        style={[
          typography.footnote,
          { color: palette.tertiaryLabel, textAlign: 'center', marginTop: spacing.sm },
        ]}
      >
        Memoh for iOS
      </Text>
    </ScrollView>
  );
}
