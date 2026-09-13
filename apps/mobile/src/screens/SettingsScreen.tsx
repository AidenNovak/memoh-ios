/**
 * 设置页。
 *
 * 只放手机上真有意义的设置。Memoh Web 端有十几个配置页（providers、memory、voice、
 * video、email…），那些都是"坐在电脑前配置一次"的东西，搬到手机上每个都会变成
 * 一堆难用的表单。这里保留的是：账号、外观、语言、以及一个进 Debug 的入口。
 *
 * 设计上刻意贴近系统「设置」的形态：分组、发丝线、行是可点的、danger 动作独立成组。
 */
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { usePalette, useTheme } from '../lib/theme/context.tsx';
import { useSession } from '../features/session/store.tsx';

const APPEARANCE_MODES: AppearanceMode[] = ['system', 'light', 'dark', 'oled'];
const APPEARANCE_KEY: Record<AppearanceMode, string> = {
  system: 'settings.appearance.system',
  light: 'settings.appearance.light',
  dark: 'settings.appearance.dark',
  oled: 'settings.appearance.oled',
};

export function SettingsScreen() {
  const palette = usePalette();
  const { spacing, typography, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { state, currentBot, signOut } = useSession();
  const { mode, setMode } = useTheme();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.groupedBackground }}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.lg,
        paddingBottom: insets.bottom + spacing.xl,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.lg,
          marginBottom: spacing.lg,
        }}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          hitSlop={12}
          style={{ width: 32, height: 44, justifyContent: 'center' }}
        >
          <Text style={[typography.body, { color: palette.accent }]}>‹</Text>
        </Pressable>
        <Text style={[typography.title2, { color: palette.label }]}>{t('settings.title')}</Text>
      </View>

      <Section title={t('settings.account')}>
        <Row label={t('settings.server')} value={state.client?.url ?? ''} />
        <Row
          label={t('settings.account')}
          value={currentBot?.display_name ?? currentBot?.name ?? ''}
          last
        />
      </Section>

      <Section title={t('settings.appearance')}>
        {APPEARANCE_MODES.map((option, index) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === option }}
            onPress={() => setMode(option)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? palette.field : palette.card,
                borderBottomColor: palette.separator,
                borderBottomWidth:
                  index === APPEARANCE_MODES.length - 1 ? 0 : StyleSheet.hairlineWidth,
                paddingHorizontal: spacing.lg,
              },
            ]}
          >
            <Text style={[typography.body, { color: palette.label, flex: 1 }]}>
              {t(APPEARANCE_KEY[option])}
            </Text>
            {mode === option ? (
              <Text style={[typography.body, { color: palette.accent }]}>✓</Text>
            ) : null}
          </Pressable>
        ))}
      </Section>
      {mode === 'oled' ? (
        <Text
          style={[
            typography.footnote,
            {
              color: palette.secondaryLabel,
              paddingHorizontal: spacing.lg,
              marginTop: -spacing.sm,
              marginBottom: spacing.lg,
            },
          ]}
        >
          {t('settings.appearance.oled.footer')}
        </Text>
      ) : null}

      <Section title={t('settings.language')}>
        {SUPPORTED_LOCALES.map((option: Locale, index) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: locale === option }}
            onPress={() => setLocale(option)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? palette.field : palette.card,
                borderBottomColor: palette.separator,
                borderBottomWidth:
                  index === SUPPORTED_LOCALES.length - 1 ? 0 : StyleSheet.hairlineWidth,
                paddingHorizontal: spacing.lg,
              },
            ]}
          >
            <Text style={[typography.body, { color: palette.label, flex: 1 }]}>
              {localeDisplayName(option)}
            </Text>
            {getLocale() === option ? (
              <Text style={[typography.body, { color: palette.accent }]}>✓</Text>
            ) : null}
          </Pressable>
        ))}
      </Section>

      <Section>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void clearSession().then(() => {
              signOut();
              router.replace('/');
            });
          }}
          style={({ pressed }) => [
            styles.row,
            {
              backgroundColor: pressed ? palette.field : palette.card,
              paddingHorizontal: spacing.lg,
              borderBottomWidth: 0,
            },
          ]}
        >
          <Text style={[typography.body, { color: palette.destructive }]}>
            {t('settings.signOut')}
          </Text>
        </Pressable>
      </Section>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/debug')}
        style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}
      >
        <Text style={[typography.footnote, { color: palette.tertiaryLabel }]}>
          {t('settings.debug')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  const palette = usePalette();
  const { spacing, typography, radius } = useTheme();
  return (
    <View style={{ marginBottom: spacing.lg }}>
      {title !== undefined ? (
        <Text
          style={[
            typography.footnote,
            {
              color: palette.secondaryLabel,
              paddingHorizontal: spacing.lg,
              marginBottom: spacing.xs,
              textTransform: 'uppercase',
            },
          ]}
        >
          {title}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: palette.card,
          borderRadius: radius.md,
          marginHorizontal: spacing.lg,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const palette = usePalette();
  const { spacing, typography } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 44,
        paddingHorizontal: spacing.lg,
        borderBottomWidth: last === true ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: palette.separator,
      }}
    >
      <Text style={[typography.body, { color: palette.label, flex: 1 }]}>{label}</Text>
      <Text
        style={[typography.subhead, { color: palette.secondaryLabel, maxWidth: '60%' }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
});
