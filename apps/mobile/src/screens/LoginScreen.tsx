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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, MemohClient } from '../api/client.ts';
import { saveSession } from '../api/credentials.ts';
import { useT } from '../lib/i18n/useT.ts';
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

      // 真正的 client 从 Keychain 读 token，而不是闭包捕获——续期后要拿到新值。
      const authed = new MemohClient({ baseUrl, getToken: () => response.access_token });
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
        <Text style={[typography.largeTitle, { color: palette.label, marginBottom: spacing.xs }]}>
          {t('login.title')}
        </Text>
        <Text style={[typography.subhead, { color: palette.secondaryLabel, marginBottom: spacing.xl }]}>
          {t('login.subtitle')}
        </Text>

        <Field
          label={t('login.server')}
          value={server}
          onChangeText={setServer}
          placeholder={t('login.server.placeholder')}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="URL"
        />
        <Field
          label={t('login.username')}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
        />
        <Field
          label={t('login.password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          onSubmitEditing={() => void submit()}
          returnKeyType="go"
        />

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
              borderRadius: radius.md,
              marginTop: spacing.xl,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={[typography.headline, { color: canSubmit ? '#FFFFFF' : palette.tertiaryLabel }]}>
              {t('login.submit')}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  ...inputProps
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  const palette = usePalette();
  const { spacing, radius, typography } = useTheme();

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text
        style={[
          typography.footnote,
          { color: palette.secondaryLabel, marginBottom: spacing.xs, textTransform: 'uppercase' },
        ]}
      >
        {label}
      </Text>
      <TextInput
        {...inputProps}
        placeholderTextColor={palette.placeholder}
        style={[
          typography.body,
          {
            color: palette.label,
            backgroundColor: palette.card,
            borderRadius: radius.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.separator,
            paddingHorizontal: spacing.md,
            // 44pt 是 iOS 触控目标下限。
            minHeight: 44,
            paddingVertical: spacing.sm,
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
