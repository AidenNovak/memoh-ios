#!/usr/bin/env bash
# 对 MemohKit 里**只依赖 UIKit** 的 Swift 文件做类型检查（`swiftc -typecheck`）。
#
# ## 为什么需要它
#
# `pnpm test:swift` 只编译 Foundation-only 那一半（Transcript / MemohStrings），
# 所以**看不见 UIKit 文件里的编译错误**。踩过：`let heading` 却对它做 `+=`、
# 以及一个 `String.text` 的笔误——两处都让纯逻辑测试全绿、iOS 构建才报错，
# 代价是等一轮完整的 xcodebuild（几分钟）。
#
# `-typecheck` 走完整类型检查但不生成代码、不链接、不需要模拟器，几秒出结果。
# 比 `-parse`（只看语法）强得多：类型不匹配、成员不存在、可变性错误都能抓到。
#
# ## 覆盖范围（重要，别当成"Swift 都检查了"）
#
# **检查**：`MessageCells.swift`——六种 cell 的全部渲染逻辑，也是上面那两个错的
# 所在。它是纯 UIKit，不需要 Expo。
#
# **不检查**：`NativeMessageList.swift`——它 `import ExpoModulesCore`，而 Pods 里
# 那份预编译 xcframework 是用稍旧的 Swift 编译器构建的
# （SDK 6.3.1 vs 本机 6.3.3），本机 `swiftc` 无法解析它的 swiftinterface。
# 于是列表调度那一块只能靠真正的 xcodebuild 兜底。
#
# ## 它做不到什么
#
# 不验证链接、不验证 Expo 模块注册、不验证运行时行为。类型检查通过 ≠ App 能构建。
# 真正的构建仍然要跑 `pnpm verify:build`。
#
# 用法：
#     Tools/typecheck-kit.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KIT="$ROOT/apps/mobile/modules/memoh-kit/ios"
SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"

sources=(
  "$KIT/Support/MemohStrings.swift"
  "$KIT/Support/MemohPalette.swift"
  "$KIT/Chat/Transcript.swift"
  "$KIT/Chat/MessageCells.swift"
)

echo "对 ${#sources[@]} 个 UIKit 文件做类型检查（iphonesimulator SDK）…"

xcrun -sdk iphonesimulator swiftc \
  -typecheck \
  -parse-as-library \
  -target arm64-apple-ios26.0-simulator \
  -sdk "$SDK" \
  "${sources[@]}"

echo "类型检查通过（不含 NativeMessageList.swift：见文件头注释）"
