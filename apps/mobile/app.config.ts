import type { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * 原生工程的唯一真源。
 *
 * `ios/` 目录是 `expo prebuild` 的产物并被 gitignore；任何原生改动都要落在这里、
 * 落在 `plugins/`，或落在 `modules/memoh-kit`。只改生成物会在下次 prebuild 时丢失。
 */
const config = ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Memoh',
  slug: 'memoh-ios',
  version: '0.1.0',
  scheme: 'memoh',
  // iOS-only。不要加 android 段，也不要让 prebuild 生成 android/。
  platforms: ['ios'],
  userInterfaceStyle: 'automatic',
  orientation: 'default',
  icon: './assets/images/icon.png',
  ios: {
    bundleIdentifier: 'ai.memoh.ios',
    // 与参考项目同一代：iOS 26 才有软滚动边缘、NativeTabs 等。
    deploymentTarget: '26.0',
    supportsTablet: true,
    infoPlist: {
      // 明文 HTTP 只用于本地联调（vultr-sg 隧道）；生产必须 HTTPS。
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
      },
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-splash-screen',
      {
        // 启动屏底色用 Memoh 的页面底（暖白/近黑），与 App 内第一屏背景**同色**。
        // 用纯白的话，冷启动时能看到"启动屏白 → App 暖白"的一次跳色。
        // 值来自 tools/oklch.py，与 tokens.ts 的 background 一致。
        backgroundColor: '#FAF8F7',
        dark: { backgroundColor: '#060606' },
        image: './assets/images/splash-icon.png',
        imageWidth: 120,
      },
    ],
    './plugins/withLocales',
    // hosted 单元测试 target（MemohKitTests），见 plugins/withKitTests.js
    './plugins/withKitTests',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});

export default config;
