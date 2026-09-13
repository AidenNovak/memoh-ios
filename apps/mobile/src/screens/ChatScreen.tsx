/** Chat orchestration; transcript rendering belongs to MemohKit. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NativeMessageList } from '@memoh-ios/kit';
import { useSession } from '../features/session/store.tsx';
import { hasContent, turnsForDisplay, type ChatState } from '../features/chat/reducer.ts';
import { useT } from '../lib/i18n/useT.ts';
import { usePalette, useTheme } from '../lib/theme/context.tsx';
import { ApprovalSheet } from '../ui/ApprovalSheet.tsx';

export function ChatScreen() {
  const params = useLocalSearchParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const isNew = sessionId === 'new';

  const palette = usePalette();
  const { spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const router = useRouter();

  const {
    state,
    openSession,
    closeSession,
    sendMessage,
    abort,
    chatFor,
    respondApproval,
    realtimeEnabled,
  } = useSession();

  // `new` 是一条真实的路由，但还没有会话 id；第一次发送时由服务端建会话。
  useEffect(() => {
    if (isNew) return;
    if (state.currentSessionId !== sessionId) openSession(sessionId);
  }, [isNew, openSession, sessionId, state.currentSessionId]);

  useEffect(() => () => closeSession(), [closeSession]);

  const chat: ChatState = chatFor(isNew ? '' : sessionId);
  const turns = useMemo(() => turnsForDisplay(chat).filter(hasContent), [chat]);
  // 标题取会话自己的名字——写死成"会话"会让所有会话长得一样，用户没法确认
  // 自己在跟哪一轮对话。
  const sessionTitle =
    state.sessions.find((entry) => entry.id === sessionId)?.title ?? t('chat.placeholder');

  const [draft, setDraft] = useState('');
  const turnsJson = useMemo(() => JSON.stringify(turns), [turns]);

  const onSend = useCallback(() => {
    const text = draft.trim();
    if (text === '') return;
    const invocationId = sendMessage(text);
    if (invocationId === null) return;
    setDraft('');
  }, [draft, sendMessage]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.groupedBackground }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View
        style={{
          paddingTop: insets.top,
          paddingBottom: spacing.sm,
          paddingHorizontal: spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: palette.separator,
          backgroundColor: palette.card,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.back}
        >
          <Text style={[typography.body, { color: palette.accent }]}>‹</Text>
        </Pressable>
        <Text style={[typography.headline, { color: palette.label, flex: 1 }]} numberOfLines={1}>
          {isNew ? t('home.newSession') : sessionTitle}
        </Text>
        {chat.stale ? (
          <Text style={[typography.caption, { color: palette.warning }]}>{t('chat.gap')}</Text>
        ) : null}
      </View>

      {!realtimeEnabled ? (
        <View style={{ backgroundColor: palette.field, padding: spacing.md }}>
          <Text style={[typography.footnote, { color: palette.secondaryLabel }]}>
            {t('chat.disconnected')}
          </Text>
        </View>
      ) : null}

      <NativeMessageList
        key={sessionId}
        turnsJson={turnsJson}
        style={{ flex: 1 }}
        emptyTitle={t('chat.empty.title')}
        emptyBody={t('chat.empty.body')}
      />

      {chat.running ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
          <Pressable
            accessibilityRole="button"
            onPress={abort}
            style={({ pressed }) => [
              styles.stop,
              { backgroundColor: palette.field, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[typography.subhead, { color: palette.destructive }]}>
              {t('chat.stop')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.sm,
          paddingTop: spacing.sm,
          gap: spacing.sm,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: palette.separator,
          backgroundColor: palette.card,
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('chat.placeholder')}
          placeholderTextColor={palette.placeholder}
          multiline
          style={[
            typography.body,
            {
              flex: 1,
              color: palette.label,
              backgroundColor: palette.field,
              borderRadius: 20,
              paddingHorizontal: spacing.md,
              paddingTop: spacing.sm,
              paddingBottom: spacing.sm,
              maxHeight: 120,
              minHeight: 40,
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.send')}
          disabled={draft.trim() === ''}
          onPress={onSend}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: draft.trim() === '' ? palette.field : palette.accent,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text
            style={[
              typography.headline,
              { color: draft.trim() === '' ? palette.tertiaryLabel : '#FFFFFF' },
            ]}
          >
            ↑
          </Text>
        </Pressable>
      </View>

      <ApprovalSheet approval={chat.approval} onChoose={respondApproval} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  back: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stop: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
});
