/**
 * 验收脚本的执行器（仅开发构建，不渲染任何 UI）。
 *
 * 挂在 `SessionProvider` 里面，所以它能用到真实的 store 动作：真实的 `sendMessage`、
 * 真实的实时通道、真实的 reducer。屏幕上看到的是产品组件本身。
 *
 * 为什么不用点击自动化：`simctl` 没有 tap 能力，而引入 XCUITest / Appium / Maestro
 * 会给这个项目加一整套重型依赖。用"脚本化动作"替代"手指"，被验证的路径本身没有变。
 *
 * 非验收场景下这个组件什么都不做，且不产生任何副作用。
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';

import { createdSessionId } from '../../api/types.ts';
import type { VerifyBootstrap } from './bootstrap.ts';
import { useSession } from '../session/store.tsx';

export function VerifyPlanRunner({ verify }: { verify: VerifyBootstrap | null }) {
  const { state, selectBot, openSession, sendMessage } = useSession();
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (verify === null || verify.plan === null) return;
    if (started.current) return;
    // 等 bot 列表到位再动手。
    if (state.bots.length === 0) return;

    const plan = verify.plan;
    const bot = state.bots[0];
    if (bot === undefined) return;

    started.current = true;

    void (async () => {
      selectBot(bot.id);

      // 让 store 的 effect 先把会话列表拉回来，再决定进哪个会话。
      await new Promise((resolve) => setTimeout(resolve, 1_500));

      const client = state.client;
      if (client === null) return;

      let sessionId = state.sessions[0]?.id;
      if (sessionId === undefined) {
        try {
          const candidate = createdSessionId(
            await client.createSession(bot.id, { title: 'Verify chat' }),
          );
          if (candidate !== null) sessionId = candidate;
        } catch {
          return;
        }
      }
      if (sessionId === undefined) return;

      openSession(sessionId);
      // 走到对话页——脚本化动作也要让界面处于产品路径上，截图才有意义。
      router.push(`/chat/${sessionId}`);

      if (plan.scenario === 'chat' && typeof plan.message === 'string') {
        // 等实时通道订阅完成（收到 snapshot）再发，否则正文收不到。
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        sendMessage(plan.message);
      }
    })();
  }, [
    verify,
    state.bots,
    state.sessions,
    state.client,
    selectBot,
    openSession,
    sendMessage,
    router,
  ]);

  return null;
}
