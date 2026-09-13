/**
 * 聊天页 —— App 的核心。
 *
 * 这一版是 RN 实现，先把协议、状态、交互跑通；消息流的虚拟化与流式文本的原生
 * 渲染（UICollectionView + CoreText）留给 MemohKit，那时只换这一层，状态与协议
 * 不动。这个顺序是刻意的：先让链路正确，再让手感到位。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RenderBlock, RenderTurn } from '../models/chat.ts';
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

  const { state, openSession, closeSession, sendMessage, abort, chatFor, respondApproval, realtimeEnabled } =
    useSession();

  // `new` 是一条真实的路由，但还没有会话 id；第一次发送时由服务端建会话。
  useEffect(() => {
    if (isNew) return;
    if (state.currentSessionId !== sessionId) openSession(sessionId);
  }, [isNew, openSession, sessionId, state.currentSessionId]);

  useEffect(() => () => closeSession(), [closeSession]);

  const chat: ChatState = chatFor(isNew ? '' : sessionId);
  const turns = useMemo(() => turnsForDisplay(chat).filter(hasContent), [chat]);

  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<RenderTurn>>(null);

  const onSend = useCallback(() => {
    const text = draft.trim();
    if (text === '') return;
    const invocationId = sendMessage(text);
    if (invocationId === null) return;
    setDraft('');
    // 乐观消息插入后滚到底。
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
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
          {isNew ? t('home.newSession') : t('home.title')}
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

      <FlatList
        ref={listRef}
        data={turns}
        keyExtractor={(turn) => turn.key}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: spacing.xl,
          flexGrow: 1,
        }}
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
            <Text style={[typography.headline, { color: palette.label, marginBottom: spacing.xs }]}>
              {t('chat.empty.title')}
            </Text>
            <Text style={[typography.subhead, { color: palette.secondaryLabel, textAlign: 'center' }]}>
              {t('chat.empty.body')}
            </Text>
          </View>
        }
        renderItem={({ item }) => <TurnView turn={item} />}
        onContentSizeChange={() => {
          // 新内容到达时跟随到底部。用户在往回翻时不打扰——这是后续要做的判断，
          // 现在先无条件跟随，因为消息量还小。
          listRef.current?.scrollToEnd({ animated: false });
        }}
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
            <Text style={[typography.subhead, { color: palette.destructive }]}>{t('chat.stop')}</Text>
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

function TurnView({ turn }: { turn: RenderTurn }) {
  const { spacing } = useTheme();
  return (
    <View style={{ marginBottom: spacing.lg, gap: spacing.sm }}>
      {turn.user !== undefined ? <UserBubble turn={turn} /> : null}
      {turn.assistant !== undefined ? <AssistantBlocks blocks={turn.assistant.blocks} /> : null}
    </View>
  );
}

function UserBubble({ turn }: { turn: RenderTurn }) {
  const palette = usePalette();
  const { spacing, typography } = useTheme();
  const text = (turn.user?.blocks ?? [])
    .map((block) => (block.kind === 'text' ? block.text : ''))
    .join('');

  return (
    <View style={{ alignItems: 'flex-end' }}>
      <View
        style={{
          backgroundColor: palette.accent,
          borderRadius: 18,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          maxWidth: '84%',
        }}
      >
        <Text style={[typography.body, { color: '#FFFFFF' }]}>{text}</Text>
      </View>
    </View>
  );
}

function AssistantBlocks({ blocks }: { blocks: RenderBlock[] }) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      {blocks.map((block) => (
        <BlockView key={block.key} block={block} />
      ))}
    </View>
  );
}

function BlockView({ block }: { block: RenderBlock }) {
  const palette = usePalette();
  const { spacing, typography, radius } = useTheme();
  const t = useT();

  switch (block.kind) {
    case 'text':
      return (
        <Text style={[typography.body, { color: palette.label }]} selectable>
          {block.text}
        </Text>
      );
    case 'reasoning':
      return (
        <View
          style={{
            borderLeftWidth: 2,
            borderLeftColor: palette.separator,
            paddingLeft: spacing.md,
          }}
        >
          <Text style={[typography.caption, { color: palette.tertiaryLabel, marginBottom: 2 }]}>
            {t('chat.reasoning')}
          </Text>
          <Text style={[typography.footnote, { color: palette.secondaryLabel }]}>{block.text}</Text>
        </View>
      );
    case 'tool':
      return (
        <View
          style={{
            backgroundColor: palette.card,
            borderRadius: radius.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.separator,
            padding: spacing.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor:
                  block.status === 'running'
                    ? palette.warning
                    : block.status === 'failed'
                      ? palette.destructive
                      : palette.success,
              }}
            />
            <Text style={[typography.footnote, { color: palette.secondaryLabel, flex: 1 }]} numberOfLines={1}>
              {block.title !== '' ? block.title : block.name}
            </Text>
            {block.status === 'running' ? <ActivityIndicator size="small" color={palette.secondaryLabel} /> : null}
          </View>
        </View>
      );
    case 'error':
      return (
        <Text style={[typography.footnote, { color: palette.destructive }]}>{block.text}</Text>
      );
    case 'notice':
      return (
        <Text style={[typography.footnote, { color: palette.secondaryLabel }]}>{block.text}</Text>
      );
    case 'attachments':
      return (
        <View style={{ gap: spacing.xs }}>
          {block.items.map((item) => (
            <Text key={item.key} style={[typography.footnote, { color: palette.accent }]}>
              {item.name}
            </Text>
          ))}
        </View>
      );
    default:
      return null;
  }
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
