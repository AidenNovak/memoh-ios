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
        backgroundColor: '#FFFFFF',
        dark: { backgroundColor: '#000000' },
        image: './assets/images/splash-icon.png',
        imageWidth: 120,
      },
    ],
    './plugins/withLocales',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});

export default config;
