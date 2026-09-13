/**
 * 翻译 hook。
 *
 * 组件用 `const t = useT()` 拿到翻译函数；语言切换时因为订阅了 locale，会重渲染。
 */
import { useCallback } from 'react';

import type { Locale } from './index.ts';
import { t as translate } from './index.ts';
import { useLocale } from './useLocale.ts';

type Params = Record<string, string | number>;

export function useT(): (key: string, params?: Params) => string {
  const locale = useLocale();
  return useCallback(
    (key: string, params?: Params) => translate(key, params),
    // translate 依赖模块级当前语言；locale 变化时必须重建这个闭包。
    [locale],
  );
}

export type { Locale };
