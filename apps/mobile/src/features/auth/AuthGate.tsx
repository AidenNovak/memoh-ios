/**
 * 登录闸门。
 *
 * 负责一件事：让"有没有凭据"变成"渲染登录页还是渲染 App"。
 *
 * 服务端的鉴权模型很简单也很硬：`POST /auth/login` → HS256 JWT，默认 168h，
 * **没有 refresh token**，过期即重登。所以这里只需要在启动时读一次 Keychain，
 * 有未过期的 token 就直接进 App。
 *
 * 明确不做的：不做"离线也能进"的降级。没有凭据就是没有凭据，展示登录页比展示
 * 一个空壳更诚实。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { MemohClient } from '../../api/client.ts';
import { loadSession, shouldRefresh, getFreshToken, saveSession } from '../../api/credentials.ts';
import { bootstrapFromVerifySeed, type VerifyBootstrap } from '../verify/bootstrap.ts';
import { LoginScreen } from '../../screens/LoginScreen.tsx';
import { useT } from '../../lib/i18n/useT.ts';
import { usePalette } from '../../lib/theme/context.tsx';
import type { SessionSeed } from '../session/store.tsx';

interface GateProps {
  /**
   * 第二个参数是验收种子（只在开发构建里非 null）。外壳用它决定要不要自动跑
   * 一段脚本化动作。
   */
  children: (seed: SessionSeed, verify: VerifyBootstrap | null) => React.ReactNode;
}

type Phase = 'checking' | 'signedOut' | 'signedIn';

export function AuthGate({ children }: GateProps) {
  const palette = usePalette();
  const t = useT();
  const [phase, setPhase] = useState<Phase>('checking');
  const [seed, setSeed] = useState<SessionSeed | null>(null);
  const [verify, setVerify] = useState<VerifyBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // 验收种子优先：它只在开发构建里存在，且没有种子时立刻返回 null。
      const bootstrap = await bootstrapFromVerifySeed();
      if (cancelled) return;
      if (bootstrap !== null) {
        setVerify(bootstrap);
        setSeed(bootstrap.seed);
        setPhase('signedIn');
        return;
      }

      const stored = await loadSession();
      if (cancelled) return;
      if (stored === null || getFreshToken() === null) {
        setPhase('signedOut');
        return;
      }

      const client = new MemohClient({
        baseUrl: stored.baseUrl,
        getToken: () => getFreshToken(),
        onUnauthorized: () => {
          setError('error.unauthorized');
          setPhase('signedOut');
        },
      });

      // 还剩一半有效期就续一次；失败不影响进入（token 可能仍然可用）。
      if (shouldRefresh()) {
        try {
          const refreshed = await client.refresh();
          await saveSession({
            ...stored,
            token: refreshed.access_token,
            expiresAt: refreshed.expires_at,
          });
        } catch {
          // 续期失败但 token 未过期时照常进入；真过期了会在首个请求上 401。
        }
      }

      if (cancelled) return;
      setSeed({ client });
      setPhase('signedIn');
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignedIn = useCallback((nextSeed: SessionSeed) => {
    setSeed(nextSeed);
    setVerify(null);
    setError(null);
    setPhase('signedIn');
  }, []);

  if (phase === 'checking') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.groupedBackground,
        }}
      >
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  if (phase === 'signedOut' || seed === null) {
    return (
      <LoginScreen onSignedIn={handleSignedIn} notice={error === null ? undefined : t(error)} />
    );
  }

  return <>{children(seed, verify)}</>;
}
