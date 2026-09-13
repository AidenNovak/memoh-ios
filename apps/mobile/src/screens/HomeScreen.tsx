/**
 * 应用主界面：会话列表（首页）。
 *
 * 设计决策（来自 `docs/research/memoh-design-baseline.md`）：
 *
 * 首页是**"最近的会话"**，不是 Agent 卡片墙。理由是 Web 端的落地页就是 Chat，
 * 打开 App 直接看到"我上次在跟谁说话、它现在在干什么"符合既有心智。
 *
 * 顶部放**跨 bot 的待审批聚合**——这是移动端最大的差异化价值：agent 7x24 在线，
 * 人在路上点一下"允许"就能让它继续，这是桌面替代不了的场景。
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../lib/i18n/useT.ts';
import { usePalette, useTheme } from '../lib/theme/context.tsx';
import { useSession, type SessionSummary } from '../features/session/store.tsx';
import {
  useSessionActivity,
  type SessionActivity,
} from '../features/activity/useSessionActivity.ts';
import { BotSwitcher } from '../ui/BotSwitcher.tsx';
import { ConnectionBadge } from '../ui/ConnectionBadge.tsx';
import { PendingApprovals } from '../ui/PendingApprovals.tsx';

export function HomeScreen() {
  const palette = usePalette();
  const { spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const router = useRouter();
  const { state, refreshSessions, openSession, selectBot, currentBot } = useSession();
  /**
   * agent 7x24 在跑，所以首页要能看到"谁在等我"——这是移动端最该做的事。
   *
   * 已知取舍：这会为每个 bot 多开一条 WebSocket（当前会话那条由 store 持有）。对
   * 自托管用户的 1–3 个 bot 来说代价可忽略，换来的是"首页直接看到待审批"。要消除
   * 这条冗余，得把 store 改成"一条连接订阅多个会话"并跨 bot 共享状态，那是更大的
   * 重构，等有明确性能压力时再做。
   */
  const { pending, active } = useSessionActivity(state.client, state.bots);

  const { sessions, sessionsLoading } = state;

  const onOpen = useCallback(
    (sessionId: string) => {
      openSession(sessionId);
      router.push(`/chat/${sessionId}`);
    },
    [openSession, router],
  );

  /**
   * 点一条活动项。
   *
   * 待处理项可能属于**另一个 bot**——用户在看 A 的时候 B 在等他批准。所以要先切 bot
   * （否则 chat 页连到错的实时通道上，进去是空的），等会话列表切过来之后再跳转。
   * 用一个 pendingJump 记住目标，会话列表就绪后执行。
   */
  const [pendingJump, setPendingJump] = useState<string | null>(null);

  const onOpenActivity = useCallback(
    (entry: SessionActivity) => {
      if (entry.botId !== state.currentBotId) {
        setPendingJump(entry.sessionId);
        selectBot(entry.botId);
        return;
      }
      onOpen(entry.sessionId);
    },
    [onOpen, selectBot, state.currentBotId],
  );

  useEffect(() => {
    if (pendingJump === null) return;
    const stillThere = state.sessions.some((session) => session.id === pendingJump);
    if (!stillThere && state.sessionsLoading) return; // 还在加载，再等等
    const target = pendingJump;
    setPendingJump(null);
    onOpen(target);
  }, [pendingJump, state.sessions, state.sessionsLoading, onOpen]);

  const onNew = useCallback(() => {
    router.push('/chat/new');
  }, [router]);

  const header = useMemo(
    () => (
      <View style={{ paddingTop: spacing.sm }}>
        <BotSwitcher />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.sm,
          }}
        >
          <Text style={[typography.title2, { color: palette.label }]}>{t('home.title')}</Text>
          <ConnectionBadge />
        </View>
        <PendingApprovals entries={pending} onOpen={onOpenActivity} />
        <ActiveRuns entries={active} />
      </View>
    ),
    [active, onOpenActivity, palette.label, pending, spacing.lg, spacing.sm, t, typography.title2],
  );

  const empty = (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xxl, alignItems: 'center' }}>
      <Text style={[typography.headline, { color: palette.label, marginBottom: spacing.xs }]}>
        {currentBot === null ? t('home.empty.title') : t('home.empty.title')}
      </Text>
      <Text style={[typography.subhead, { color: palette.secondaryLabel, textAlign: 'center' }]}>
        {t('home.empty.body')}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.groupedBackground, paddingTop: insets.top }}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        ListEmptyComponent={sessionsLoading ? null : empty}
        refreshControl={
          <RefreshControl
            refreshing={sessionsLoading}
            onRefresh={() => void refreshSessions()}
            tintColor={palette.secondaryLabel}
          />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        renderItem={({ item }) => <SessionRow session={item} onPress={() => onOpen(item.id)} />}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('home.newSession')}
        onPress={onNew}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: palette.accent,
            bottom: insets.bottom + spacing.lg,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text style={styles.fabGlyph}>＋</Text>
      </Pressable>
    </View>
  );
}

/** 正在跑的会话。比待审批弱一档——用户不需要动手，但知道"它在干活"是安心的。 */
function ActiveRuns({ entries }: { entries: SessionActivity[] }) {
  const { spacing, typography } = useTheme();
  const palette = usePalette();
  const t = useT();
  // 待审批的已经在上面单独显示了，这里不重复。
  const running = entries.filter((entry) => entry.status !== 'waiting_decision');
  if (running.length === 0) return null;

  return (
    <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.sm }}>
      {running.map((entry) => (
        <View
          key={entry.sessionId}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 }}
        >
          <View
            style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.success }}
          />
          <Text
            style={[typography.footnote, { color: palette.secondaryLabel, flex: 1 }]}
            numberOfLines={1}
          >
            {entry.sessionTitle} · {t('chat.thinking')}
          </Text>
        </View>
      ))}
    </View>
  );
}

function SessionRow({ session, onPress }: { session: SessionSummary; onPress: () => void }) {
  const palette = usePalette();
  const { spacing, typography } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? palette.field : palette.card,
          borderBottomColor: palette.separator,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
        },
      ]}
    >
      <Text style={[typography.body, { color: palette.label }]} numberOfLines={1}>
        {session.title}
      </Text>
      <Text style={[typography.footnote, { color: palette.tertiaryLabel, marginTop: 2 }]}>
        {formatRelative(session.updatedAt)}
      </Text>
    </Pressable>
  );
}

/** 相对时间的粗粒度展示。精确到分钟没必要——列表只用来扫一眼。 */
function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabGlyph: {
    color: '#FFFFFF',
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '400',
  },
});
