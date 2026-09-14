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
import { sessionDisplayTitle } from '../features/session/displayTitle.ts';
import { hasContent, turnsForDisplay, type ChatState } from '../features/chat/reducer.ts';
import { useT } from '../lib/i18n/useT.ts';
import { radius, radiusStyle } from '../lib/theme/tokens.ts';
import { usePalette, useTheme } from '../lib/theme/context.tsx';
import { ApprovalSheet } from '../ui/ApprovalSheet.tsx';
import { composerActionWithSupport } from '../features/chat/queue.ts';
import { QueueStrip } from '../ui/QueueStrip.tsx';
import { SessionInfoSheet } from '../ui/SessionInfoSheet.tsx';
import { UserInputSheet } from '../ui/UserInputSheet.tsx';

export function ChatScreen() {
  const params = useLocalSearchParams<{ sessionId: string; info?: string }>();
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
    submit,
    queueFor,
    removeQueueItem,
    promoteQueueItem,
    abort,
    chatFor,
    respondApproval,
    respondUserInput,
    realtimeEnabled,
    currentBot,
    sessionStatusFor,
    refreshSessionStatus,
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
  const sessionTitle = sessionDisplayTitle(
    { title: state.sessions.find((entry) => entry.id === sessionId)?.title ?? '' },
    t,
  );

  const [draft, setDraft] = useState('');
  const queue = queueFor(isNew ? '' : sessionId);
  const [infoOpen, setInfoOpen] = useState(false);
  /**
   面板的取数状态。

   为什么要有它：面板是"点开就想看到数"的东西，而 `/status` 是异步的。之前把
   `loading` 写死成 false，结果是**面板弹出来空的、而且永远不解释为什么空**——
   用户只会以为功能坏了。验收的 chat-info 就是在这个空档里断言失败，才暴露出来。
   */
  const [infoState, setInfoState] = useState<{ loading: boolean; failed: boolean }>({
    loading: false,
    failed: false,
  });
  const sessionStatus = sessionStatusFor(isNew ? '' : sessionId);

  /**
   运行中按钮的语义（与上游同一个圆按钮一致，见 chat-pane 的 handleSendButton）：
   
   - **有文字**：这句话排进队列（follow-up，这一轮跑完再跑）；
   - **没文字**：停止这一轮。
   
   所以 `canSend` 不再等于"正在生成"——正在生成且有文字时它也能点，而那时点下去
   是**排队**而不是停止。之前是"运行中一律停止"，于是用户想补一句只能先打断，
   而"补一句"恰恰是人在外面最常见的动作。
   */
  const hasDraft = draft.trim() !== '';
  // 运行中：支持队列时有文字也能点（排队）；不支持时保持"运行中=停止"（与桌面端一致）。
  const canSend = hasDraft || chat.running;
  /** 按钮此刻是什么：排队 / 停止。这决定字形，也决定无障碍标签。 */
  /**
   按钮此刻是什么：发送 / 排队 / 停止。判定在纯逻辑里（`composerActionWithSupport`）——
   它依赖"这个服务端到底支不支持队列"。实测部署版本不支持，那时运行中的按钮必须
   回到"停止"语义（与同一部署的桌面端一致），而不是给一个必然失败的入口。
   */
  const action = composerActionWithSupport({
    running: chat.running,
    hasDraft,
    support: queue.support,
  });
  // 无障碍标签要说清这一下会发生什么："排队"和"发送"对用户是两件事。
  let sendLabel = t('chat.send');
  if (action === 'stop') sendLabel = t('chat.stop');
  else if (action === 'queue') sendLabel = t('queue.send');
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

  /** 打开会话信息面板。先刷新一次——面板里的数字是"现在的"，不该是进会话时的。 */
  const openInfo = useCallback(() => {
    setInfoOpen(true);
    if (isNew) return;
    setInfoState({ loading: true, failed: false });
    void (async () => {
      try {
        await refreshSessionStatus(sessionId);
        setInfoState({ loading: false, failed: false });
      } catch {
        // 说清楚"这次没读到"，而不是留一个空面板。
        setInfoState({ loading: false, failed: true });
      }
    })();
  }, [isNew, refreshSessionStatus, sessionId]);

  // `?info=1`：验收种子要求进来就打开面板（模拟器没有点击能力）。
  // 走的是上面同一个处理函数，所以验的是产品的真实路径。
  useEffect(() => {
    if (params.info !== '1' || isNew) return;
    openInfo();
  }, [params.info, isNew, openInfo]);

  const onSend = useCallback(() => {
    const text = draft.trim();
    if (text === '') return;
    // 草稿**先留着**：只有真的发出去（或排上了）才清。失败还留着，用户不用重写。
    void submit(text).then((result) => {
      if (result === 'sent' || result === 'queued') setDraft('');
    });
  }, [draft, submit]);

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
        {/* 标题即入口：点它看会话信息（设计基线里"标题可点=会话信息"）。
            iOS 上这是常规做法——导航栏标题承载上下文，而不是另设一个按钮。 */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('sessionInfo.open')}
          accessibilityHint={t('sessionInfo.title')}
          onPress={openInfo}
          style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={[typography.headline, { color: palette.label }]} numberOfLines={1}>
            {isNew ? t('home.newSession') : sessionTitle}
          </Text>
          <Text style={[typography.caption, { color: palette.secondaryLabel }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </Pressable>
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

      {/*
        输入区。

        形态照 iOS 消息类 App：一行**分离的两件东西**——左边一个可增高的输入胶囊，
        右边一个 34pt 圆形按钮。两者之间 8pt。

        为什么不把按钮放进胶囊里：那是 Web 聊天框的样子（一个框里塞输入和按钮）。
        iOS 上输入框和动作按钮是分开的两个控件，按钮的圆是**正圆**而不是圆角方块。
        视觉评审把"输入区"列为最容易失分的地方之一，主要就是这两点。

        生成中时按钮**在同一个位置**变成停止：用户的心智模型是"那个位置现在能停"，
        在别处冒出一个红色胶囊既不像系统控件也遮挡内容。形状不变、只换字形，
        所以中途不会闪。
      */}
      {/* 待发队列：还没有发出去的话，排在 composer 正上方（不是消息流里）。 */}
      <QueueStrip queue={queue} onRemove={removeQueueItem} onPromote={promoteQueueItem} />

      {/*
        agent 提问期间**隐藏输入区**：提问是"当前待办"，与 composer 争同一个位置
        只会让人不知道该用哪个（上游 Web 也是表单接管 composer）。
      */}
      {chat.userInput === null ? (
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
                // 半高圆角：34pt 高时是胶囊，长高了自然变成圆角矩形。
                ...radiusStyle(radius.lg),
                paddingHorizontal: spacing.md,
                // 上下对称的内边距。给单边额外 padding 会让多行时的首行偏移。
                paddingVertical: spacing.sm,
                // 34pt 起步（与按钮同高），最多约 5 行。
                maxHeight: 120,
                minHeight: 34,
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sendLabel}
            disabled={!canSend}
            onPress={action === 'stop' ? abort : onSend}
            style={({ pressed }) => [
              styles.send,
              {
                backgroundColor: canSend ? palette.accent : palette.field,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text
              style={[
                typography.subhead,
                {
                  fontWeight: '600',
                  color: canSend ? palette.onAccent : palette.tertiaryLabel,
                },
              ]}
            >
              {/* 形状不变、只换字形：同一个位置，中途不会闪（既有评审结论）。 */}
              {action === 'stop' ? '■' : '↑'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <ApprovalSheet approval={chat.approval} onChoose={respondApproval} />
      {/*
        提问表用 `key` 绑定提问 id：换一次提问就重新挂载，草稿不会串到下一份。
        不可跳过——run 停在 waiting_decision 上，不答（或取消）它就永远不继续。
      */}
      <UserInputSheet
        key={chat.userInput?.userInputId ?? 'none'}
        userInput={chat.userInput}
        onSubmit={(answers) => respondUserInput({ answers })}
        onCancel={() => respondUserInput({ canceled: true })}
      />

      <SessionInfoSheet
        visible={infoOpen}
        status={sessionStatus}
        loading={infoState.loading}
        // 已经显示到数的会话不该因为一次失败的刷新变成一片红：失败提示只在
        // 面板里真的没有数可看时才给。
        error={infoState.failed && sessionStatus === null ? t('sessionInfo.loadFailed') : null}
        onClose={() => setInfoOpen(false)}
      />
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
    // 34pt 正圆，与输入框起始高度对齐——iOS 消息类 App 的比例。
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
