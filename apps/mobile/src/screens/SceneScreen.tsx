/**
 * 场景查看页（仅开发）。
 *
 * 从 Debug 页进来，列出所有场景。点进去用**真实屏幕组件**渲染回放结果——
 * 这是设计迭代的快照台：改完看这里，而不是每次都去连真服务端跑一轮。
 *
 * 它不依赖登录、不依赖服务端、不依赖网络。验收基线要在空手上能复现，这一页是
 * 那个承诺的落点。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hasContent, turnsForDisplay } from '../features/chat/reducer.ts';
import { useScenePlayback } from '../features/verify/playback.ts';
import { findScene, SCENES } from '../features/verify/scenes.ts';
import { NativeMessageList } from '@memoh-ios/kit';
import { ApprovalSheet } from '../ui/ApprovalSheet.tsx';
import { UserInputSheet } from '../ui/UserInputSheet.tsx';
import { usePalette, useTheme } from '../lib/theme/context.tsx';

/** 场景索引：列出全部场景，点进去看。 */
export function SceneIndexScreen() {
  const palette = usePalette();
  const { spacing, typography, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.groupedBackground }}
      contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.lg }}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={[typography.body, { color: '#007AFF' }]}>‹ Back</Text>
      </Pressable>
      <Text style={[typography.title2, { color: palette.label, marginBottom: spacing.xs }]}>
        Scenes
      </Text>
      <Text
        style={[typography.footnote, { color: palette.secondaryLabel, marginBottom: spacing.lg }]}
      >
        用真实组件渲染固定帧序列。不依赖登录、服务端或网络。
      </Text>

      <View style={{ backgroundColor: palette.card, borderRadius: radius.md, overflow: 'hidden' }}>
        {SCENES.map((scene, index) => (
          <Pressable
            key={scene.id}
            accessibilityRole="button"
            onPress={() => router.push(`/debug/scene/${scene.id}`)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? palette.field : palette.card,
                borderBottomWidth: index === SCENES.length - 1 ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: palette.separator,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[typography.callout, { color: palette.label }]}>{scene.title}</Text>
              <Text
                style={[typography.footnote, { color: palette.secondaryLabel, marginTop: 2 }]}
                numberOfLines={2}
              >
                {scene.intent}
              </Text>
            </View>
            <Text style={[typography.body, { color: palette.tertiaryLabel }]}>›</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * 单个场景。
 *
 * ⚠️ 这里刻意**复用 ChatScreen 的渲染分支**（NativeMessageList + ApprovalSheet），
 * 而不是另写一套。另写一套的话，改坏了生产组件这里看不出来——场景就失去了意义。
 */
export function SceneScreen() {
  const params = useLocalSearchParams<{ sceneId: string }>();
  const palette = usePalette();
  const { spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const scene = useMemo(
    () => (params.sceneId ? findScene(params.sceneId) : null),
    [params.sceneId],
  );
  const { chat, progress, done } = useScenePlayback(scene);

  const turns = useMemo(() => turnsForDisplay(chat).filter(hasContent), [chat]);
  const turnsJson = useMemo(() => JSON.stringify(turns), [turns]);

  if (scene === null) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.groupedBackground,
        }}
      >
        <Text style={[typography.body, { color: palette.secondaryLabel }]}>未知场景</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={[typography.body, { color: '#007AFF' }]}>‹ Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
      <View
        style={{
          paddingTop: insets.top,
          paddingBottom: spacing.sm,
          paddingHorizontal: spacing.lg,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: palette.separator,
          backgroundColor: palette.card,
        }}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={[typography.body, { color: '#007AFF' }]}>‹ Scenes</Text>
        </Pressable>
        <Text style={[typography.headline, { color: palette.label }]} numberOfLines={1}>
          {scene.title}
        </Text>
        {/* 调试信息刻意保持**极简**：只有标题、id、进度三行。
            场景的"期望效果"在场景索引页里看（那里是浏览的地方），不占截图——
            截图上多一行说明文字，就多一分"这是原型不是产品"的观感，而截图正是
            拿来判断观感的。

            id 必须留在屏幕上：验收脚本靠它确认"确实是这个场景"，比匹配中文标题可靠
            （标题里的全角标点 OCR 认出来未必一致）。 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text
            style={[typography.caption2, { color: palette.tertiaryLabel }]}
          >{`#${scene.id}`}</Text>
          <Text style={[typography.caption2, { color: done ? palette.success : palette.warning }]}>
            {done
              ? `replayed ${progress.total}/${progress.total}`
              : `frame ${progress.current}/${progress.total}`}
          </Text>
        </View>
      </View>

      {chat.runStatus === 'errored' ? (
        <View
          style={{
            backgroundColor: palette.field,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
          }}
        >
          <Text style={[typography.subhead, { color: palette.destructive }]}>Run failed</Text>
          {chat.runError !== null ? (
            <Text style={[typography.footnote, { color: palette.secondaryLabel, marginTop: 2 }]}>
              {chat.runError}
            </Text>
          ) : null}
        </View>
      ) : null}

      <NativeMessageList
        key={scene.id}
        turnsJson={turnsJson}
        style={{ flex: 1 }}
        emptyTitle="No messages"
        emptyBody=""
      />

      {/* 审批面板在场景里也只是渲染，不做动作——场景只负责展示状态。 */}
      <ApprovalSheet approval={chat.approval} onChoose={() => {}} />
      {/* 与 ChatScreen 同一套分支：场景台要能看见提问表的真实样子。
          这里的提交/取消是空实现——场景不连服务端。 */}
      <UserInputSheet
        key={chat.userInput?.userInputId ?? 'none'}
        userInput={chat.userInput}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 64,
  },
});
