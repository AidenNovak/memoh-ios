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
    currentBot,
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

  /**
   * 副标题：谁在说话 · 现在在干什么。
   *
   * 把"正在生成"放在这里，而不是在内容区挂一个悬浮胶囊——导航栏的副标题是系统里
   * 传达这类状态的既有位置。
   */
  const subtitle = useMemo(() => {
    // 不写嵌套三元（AGENTS.md 明确禁止）：可读性差且容易读反。
    let who = '';
    if (currentBot !== null) {
      who = currentBot.display_name !== '' ? currentBot.display_name : currentBot.name;
    }
    let what = '';
    if (chat.running) what = t('chat.thinking');
    else if (chat.stale) what = t('chat.gap');
    return [who, what].filter((part) => part !== '').join(' · ');
  }, [chat.running, chat.stale, currentBot, t]);

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
      {/*
        导航栏：标题 + 副标题，不用"一条白底 + 一条生硬分隔线"把屏幕切成两块色。
        副标题承担状态传达（谁 · 在干什么），这样生成中就不必在内容区再挂一个胶囊。
      */}
      <View
        style={{
          paddingTop: insets.top,
          paddingBottom: spacing.sm,
          paddingHorizontal: spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
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
          {/* 系统蓝：导航是系统控件，品牌色克制使用。 */}
          <Text style={[typography.title3, { color: '#007AFF' }]}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[typography.headline, { color: palette.label }]} numberOfLines={1}>
            {isNew ? t('home.newSession') : sessionTitle}
          </Text>
          <Text style={[typography.caption, { color: palette.secondaryLabel }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
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

      {/*
        run 失败时说清楚。之前 `runError` 只存在状态里、界面上什么都不显示，
        用户的感受就是"卡住了"——而实际上服务端已经给了明确的原因。
      */}
      {chat.runStatus === 'errored' ? (
        <View
          style={{
            backgroundColor: palette.field,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: palette.separator,
          }}
        >
          <Text style={[typography.subhead, { color: palette.destructive }]}>
            {t('chat.run.failed')}
          </Text>
          {chat.runError !== null ? (
            <Text style={[typography.footnote, { color: palette.secondaryLabel, marginTop: 2 }]}>
              {/* 我们自己的错误用 i18n key；服务端给的是已经本地化过的文案，原样显示。 */}
              {chat.runError.startsWith('error.') ? t(chat.runError) : chat.runError}
            </Text>
          ) : null}
        </View>
      ) : null}

      <NativeMessageList
        key={sessionId}
        turnsJson={turnsJson}
        style={{ flex: 1 }}
        emptyTitle={t('chat.empty.title')}
        emptyBody={t('chat.empty.body')}
      />

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
              // 半高圆角：36pt 高时是胶囊，长高了自然变成圆角矩形。
              borderRadius: 18,
              paddingHorizontal: spacing.md,
              paddingTop: spacing.sm,
              paddingBottom: spacing.sm,
              // 36pt 起步、最多 5 行左右。
              maxHeight: 120,
              minHeight: 36,
            },
          ]}
        />
        {/*
          生成中时**同一个位置**变成停止按钮，而不是在旁边多出一个悬浮胶囊。
          用户的心智模型是"那个箭头的位置现在可以停"——在别处放一个红色胶囊
          既不像系统控件，也遮挡内容。
        */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={chat.running ? t('chat.stop') : t('chat.send')}
          disabled={!chat.running && draft.trim() === ''}
          onPress={chat.running ? abort : onSend}
          style={({ pressed }) => [
            styles.send,
            {
              // 有文字（或正在生成）时是品牌色实心，否则是灰色——常灰会让人以为
              // 按钮永远不可用。
              backgroundColor: chat.running || draft.trim() !== '' ? palette.accent : palette.field,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text
            style={[
              typography.headline,
              {
                color: chat.running || draft.trim() !== '' ? '#FFFFFF' : palette.tertiaryLabel,
              },
            ]}
          >
            {chat.running ? '■' : '↑'}
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
});
