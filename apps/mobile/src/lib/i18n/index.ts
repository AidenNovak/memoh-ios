/**
 * 极小 i18n。
 *
 * 文案的唯一真源是 `locales/{en,zh-Hans}.json`（单层扁平 key，点号分层）。
 * `pnpm i18n:check` 保证两个文件的 key 集合完全一致。config plugin `withLocales`
 * 会在 prebuild 时把同一份 JSON 投影成原生 `xcstrings`，让系统控件（返回、
 * 分享菜单、权限弹窗）也吃到本地化。
 *
 * 不支持复数规则：中英都用 `{{count}}` 直接插值。这是刻意的——两门语言都不需要
 * 词形变化，为此引入 ICU 依赖不划算。真需要时再加。
 */
import { getLocales } from 'expo-localization';

import en from '../../../locales/en.json';
import zhHans from '../../../locales/zh-Hans.json';

export type Locale = 'en' | 'zh-Hans';

const catalogs: Record<Locale, Record<string, string>> = {
  en,
  'zh-Hans': zhHans,
};

const FALLBACK: Locale = 'en';

let current: Locale = FALLBACK;
const listeners = new Set<() => void>();

function normalize(tag: string | null | undefined): Locale {
  if (!tag) return FALLBACK;
  const lower = tag.toLowerCase();
  if (lower.startsWith('zh')) return 'zh-Hans';
  return 'en';
}

/** 必须在渲染第一帧之前调用（见 `boot.ts`）。 */
export function initI18n(): void {
  try {
    const [first] = getLocales();
    current = normalize(first?.languageTag);
  } catch {
    current = FALLBACK;
  }
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type Params = Record<string, string | number>;

/**
 * 翻译。查不到的 key 原样返回 key 本身——这样 UI 上会立刻看出漏翻，
 * 而不是静默显示空白。
 */
export function t(key: string, params?: Params): string {
  const template = catalogs[current][key] ?? catalogs[FALLBACK][key] ?? key;
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** 已格式化的展示用语言名。 */
export function localeDisplayName(locale: Locale): string {
  if (locale === 'zh-Hans') return '简体中文';
  return 'English';
}

export const SUPPORTED_LOCALES: Locale[] = ['en', 'zh-Hans'];
