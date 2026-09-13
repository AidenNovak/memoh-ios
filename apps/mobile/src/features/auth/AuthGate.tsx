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
import { LoginScreen } from '../../screens/LoginScreen.tsx';
import { useT } from '../../lib/i18n/useT.ts';
import { usePalette } from '../../lib/theme/context.tsx';
import type { SessionSeed } from '../session/store.tsx';

interface GateProps {
  children: (seed: SessionSeed) => React.ReactNode;
  /**
   * 跳过 Keychain，直接用一个给定的凭据进入 App。
   * 只给 Debug / 验收场景用——生产路径永远走 Keychain。
   */
  debugSeed?: SessionSeed;
}

type Phase = 'checking' | 'signedOut' | 'signedIn';

export function AuthGate({ children, debugSeed }: GateProps) {
  const palette = usePalette();
  const t = useT();
  const [phase, setPhase] = useState<Phase>(debugSeed ? 'signedIn' : 'checking');
  const [seed, setSeed] = useState<SessionSeed | null>(debugSeed ?? null);
  const [error, setError] = useState<string | null>(null);

  // 启动时读一次 Keychain，并顺手做一次静默续期。
  useEffect(() => {
    if (debugSeed) return;
    let cancelled = false;

    void (async () => {
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
          await saveSession({ ...stored, token: refreshed.access_token, expiresAt: refreshed.expires_at });
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
  }, [debugSeed]);

  const handleSignedIn = useCallback((nextSeed: SessionSeed) => {
    setSeed(nextSeed);
    setError(null);
    setPhase('signedIn');
  }, []);

  if (phase === 'checking') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.groupedBackground }}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  if (phase === 'signedOut' || seed === null) {
    return <LoginScreen onSignedIn={handleSignedIn} notice={error === null ? undefined : t(error)} />;
  }

  return <>{children(seed)}</>;
}
