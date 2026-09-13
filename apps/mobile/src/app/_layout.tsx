/**
 * App 根布局。
 *
 * 职责只有三件：主题、i18n、以及决定"登录还是不登录"。
 * 会话状态（bots / sessions / chats）由 `SessionProvider` 承载，但它需要凭据，
 * 所以放在 `AuthGate` 里面按需挂载。
 */
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthGate } from '../features/auth/AuthGate.tsx';
import { SessionProvider } from '../features/session/store.tsx';
import { useLocale } from '../lib/i18n/useLocale.ts';
import { ThemeProvider, useTheme } from '../lib/theme/context.tsx';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedRoot />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ThemedRoot() {
  const { palette, scheme } = useTheme();
  // 订阅语言变化：切换语言时整棵树重渲染。
  useLocale();

  // 把自己的调色板接到 React Navigation 上，避免两套主题打架。
  const navTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: palette.groupedBackground,
        card: palette.card,
        text: palette.label,
        border: palette.separator,
        primary: palette.accent,
      },
    };
  }, [palette, scheme]);

  return (
    <NavThemeProvider value={navTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <AuthGate>
        {(seed) => (
          <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
            <SessionProvider seed={seed}>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: palette.groupedBackground },
                }}
              />
            </SessionProvider>
          </View>
        )}
      </AuthGate>
    </NavThemeProvider>
  );
}
