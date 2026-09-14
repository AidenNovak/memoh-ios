/**
 * 登录页。
 *
 * 一个服务器地址 + 用户名 + 密码。原生形态：grouped 表单、原生键盘类型、
 * 提交时禁用重复提交并给出内联错误。
 *
 * 注意错误文案的分工：网络不通和密码错是两件不同的事，用户需要能区分。
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, MemohClient } from '../api/client.ts';
import { getFreshToken, saveSession } from '../api/credentials.ts';
import { useT } from '../lib/i18n/useT.ts';
import { radiusStyle, spacing as space, typography as type } from '../lib/theme/tokens.ts';
import { usePalette, useTheme } from '../lib/theme/context.tsx';
import type { SessionSeed } from '../features/session/store.tsx';

/**
 * 默认地址。开发期指向本地隧道（见 README），生产由用户填自己的服务器。
 * 用常量而不是读构建变量：这是给自托管用户看的输入框默认值，不是配置项。
 */
const DEFAULT_SERVER = 'http://127.0.0.1:18080';

export function LoginScreen({
  onSignedIn,
  notice,
}: {
  onSignedIn: (seed: SessionSeed) => void;
  notice?: string;
}) {
  const palette = usePalette();
  const { spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();

  const [server, setServer] = useState(DEFAULT_SERVER);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(notice ?? null);

  const submit = useCallback(async () => {
    if (busy) return;
    const baseUrl = server.trim();
    if (baseUrl === '' || username.trim() === '' || password === '') {
      setError('login.failed');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const client = new MemohClient({
        baseUrl,
        // 登录前还没有 token；登录成功后这个闭包换成读 Keychain。
        getToken: () => null,
      });
      const response = await client.login(username.trim(), password);

      await saveSession({
        baseUrl,
        token: response.access_token,
        expiresAt: response.expires_at,
        userId: response.user_id,
        username: response.username,
        displayName: response.display_name,
        role: response.role,
        timezone: response.timezone,
      });

      // 真正的 client 从凭据存储读 token，而不是闭包捕获一个快照——续期之后
      // 闭包里那个旧字符串会失效，而 `getFreshToken()` 永远是当前有效的那个。
      const authed = new MemohClient({ baseUrl, getToken: () => getFreshToken() });
      onSignedIn({ client: authed });
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 401) setError('login.invalidCredentials');
        else if (caught.isNetwork) setError('login.unreachable');
        else setError(caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      setBusy(false);
    }
  }, [busy, onSignedIn, password, server, username]);

  const canSubmit = server.trim() !== '' && username.trim() !== '' && password !== '' && !busy;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.groupedBackground }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: spacing.lg,
          paddingTop: insets.top + spacing.xl,
          paddingBottom: insets.bottom + spacing.xl,
        }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        {/* 品牌标记：Memoh 的水母 logo。
            和桌面端登录页一样用**裸 logo**（它在 Web 上就是 size-14 直接放的，
            没有底色方块），所以这里也不加背景色——加了会变成一个"图标按钮"，
            而它不是可点的。 */}
        <Image
          source={require('../../assets/images/brand-mark.png')}
          style={{ width: 64, height: 64, alignSelf: 'center', marginBottom: spacing.xxl }}
          contentFit="contain"
          accessibilityIgnoresInvertColors
        />

        <Text
          style={[
            typography.largeTitle,
            { color: palette.label, textAlign: 'center', marginBottom: spacing.sm },
          ]}
        >
          {t('login.title')}
        </Text>
        <Text
          style={[
            typography.subhead,
            { color: palette.secondaryLabel, textAlign: 'center', marginBottom: spacing.xxl },
          ]}
        >
          {t('login.subtitle')}
        </Text>

        <View
          style={{
            backgroundColor: palette.card,
            overflow: 'hidden',
            ...radiusStyle(radius.md),
          }}
        >
          <FormRow
            label={t('login.server')}
            value={server}
            onChangeText={setServer}
            placeholder={t('login.server.placeholder')}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="URL"
          />
          <FormRow
            label={t('login.username')}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
          />
          <FormRow
            label={t('login.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            onSubmitEditing={() => void submit()}
            returnKeyType="go"
            last
          />
        </View>

        {error !== null ? (
          <Text
            style={[typography.footnote, { color: palette.destructive, marginTop: spacing.md }]}
            accessibilityLiveRegion="polite"
          >
            {error.startsWith('login.') || error.startsWith('error.') ? t(error) : error}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit, busy }}
          disabled={!canSubmit}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.submit,
            {
              backgroundColor: canSubmit ? palette.accent : palette.field,
              marginTop: spacing.xxl,
              opacity: pressed ? 0.85 : 1,
              ...radiusStyle(radius.pill),
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={palette.onAccent} />
          ) : (
            <Text
              style={[
                typography.headline,
                { color: canSubmit ? palette.onAccent : palette.tertiaryLabel },
              ]}
            >
              {t('login.submit')}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * 分组表单行（系统「设置」的形态）。
 *
 * 之前用"全大写小标签悬浮在输入框上方"是 Web/Material 的模式，在 iOS 上会显得
 * 不是原生——而且实测那个布局的**组内距（12pt）比组间距（11pt）还大**，眼睛会把
 * 标签归到上一个框，读起来是乱的。
 *
 * 原生做法是：一张 inset 圆角卡片，行内左侧标签、右侧输入，行高 44pt（系统最小
 * 触控目标），行间 0.5pt 发丝线且左缩进对齐文字起点。
 */
function FormRow({
  label,
  last,
  ...inputProps
}: { label: string; last?: boolean } & React.ComponentProps<typeof TextInput>) {
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
      <Text style={[typography.body, { color: palette.label, width: 88 }]} numberOfLines={1}>
        {label}
      </Text>
      <TextInput
        {...inputProps}
        placeholderTextColor={palette.placeholder}
        style={[
          typography.body,
          {
            color: palette.label,
            flex: 1,
            paddingVertical: spacing.sm,
            minHeight: 44,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  submit: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
