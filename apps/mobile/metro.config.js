const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

// 多个 worktree 共享 Metro 缓存时会互相污染（Expo 的 DOM transform 会把绝对路径
// 内联进产物）。把 __dirname 混进 cacheVersion 是这一行的全部目的。
config.cacheVersion = (config.cacheVersion ?? '') + ':' + __dirname;

// `@memoh-ios/kit` 是仓库内的本地模块，不是 node_modules 里的包。tsconfig 的
// paths 管类型，Metro 需要额外告诉它去哪找。
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@memoh-ios/kit': path.resolve(__dirname, 'modules/memoh-kit/src'),
};

module.exports = config;
