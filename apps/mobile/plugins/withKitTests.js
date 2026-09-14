#!/usr/bin/env node
/**
 * config plugin：往生成的 Xcode 工程里加一个 **hosted 单元测试 target**（MemohKitTests）。
 *
 * 为什么需要它：`modules/memoh-kit/verification/MessageListTests.swift` 里 UIKit 那一半
 * 断言（cell 复用、颜色映射、无障碍、贴底）只在 iOS 模拟器上能跑，但没有任何 target
 * 编译它们——一直是死代码。加一个 hosted target 让 `xcodebuild test` 能真正跑到。
 *
 * 为什么是 hosted（TEST_HOST = App）而不是独立 bundle：
 * - 测试要的 UIKit/XCTest 环境由宿主 App 提供，不用另起一份工程或 pod 图；
 * - hosted 测试跑在 App 进程里，行为最接近真实。
 *
 * 为什么源码直接编进测试 bundle、而不是依赖 MemohKit pod：
 * - MemohKit pod 通过 Expo autolinking 挂到 App target；再挂一份到测试 target 需要
 *   改 Podfile + 重新 pod install，而 Podfile 也是 prebuild 生成的，会来回打架；
 * - 直接编译 4 个 UIKit 源文件 + 测试文件，零 pod 依赖，prebuild 幂等。
 *
 * 为什么排除 `Chat/NativeMessageList.swift`：
 * - 它 `import ExpoModulesCore`（整棵 RN pod 图），独立编译不成立；
 * - 与 `tools/typecheck-kit.sh` 排除它的先例一致；它的贴底/锚点**数值**已由
 *   `MessageListMetrics` 的 17 个纯逻辑测试覆盖（`pnpm test:swift`）。
 *
 * `ios/` 是 prebuild 产物；本插件的改动随每次 prebuild 重新应用。
 */
const { withXcodeProject } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const TEST_TARGET = 'MemohKitTests';
const TEST_BUNDLE_ID = 'ai.memoh.kit-tests';

/** 相对 apps/mobile/ 的源码列表。顺序无关，但保持与 podspec 的 source_files 对齐。 */
const SOURCE_FILES = [
  'modules/memoh-kit/ios/Chat/Transcript.swift',
  'modules/memoh-kit/ios/Chat/MessageCells.swift',
  'modules/memoh-kit/ios/Support/MemohStrings.swift',
  'modules/memoh-kit/ios/Support/MemohPalette.swift',
  'modules/memoh-kit/verification/MessageListTests.swift',
];

/** 把 scheme 里 Testables 换成真实存在的测试 target（Expo 模板残留的 MemohTests 是幽灵）。 */
function rewriteTestables(schemePath, blueprintId) {
  const xml = fs.readFileSync(schemePath, 'utf8');
  const testable = [
    '<Testables>',
    '      <TestableReference',
    '         skipped = "NO">',
    '         <BuildableReference',
    '            BuildableIdentifier = "primary"',
    `            BlueprintIdentifier = "${blueprintId}"`,
    '            BuildableName = "MemohKitTests.xctest"',
    '            BlueprintName = "MemohKitTests"',
    '            ReferencedContainer = "container:Memoh.xcodeproj">',
    '         </BuildableReference>',
    '      </TestableReference>',
    '   </Testables>',
  ].join('\n');

  const replaced = xml.replace(/<Testables>[\s\S]*?<\/Testables>/, testable);
  if (replaced === xml) {
    throw new Error('withKitTests: scheme 里找不到 <Testables> 块，无法注入测试 target');
  }
  fs.writeFileSync(schemePath, replaced, 'utf8');
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withKitTests = (config) =>
  withXcodeProject(config, (config) => {
    const iosRoot = config.modRequest.platformProjectRoot;
    const mobileRoot = path.dirname(iosRoot);

    if (config.modResults.pbxTargetByName(TEST_TARGET)) {
      return config; // 幂等：prebuild 重跑不会重复加
    }

    const project = config.modResults;
    project.addTarget(TEST_TARGET, 'unit_test_bundle', null, TEST_BUNDLE_ID);
    // xcode 包的 addTarget 把 name 存成带引号（'"MemohKitTests"'），pbxTargetByName
    // 查不到；直接扫 section 取 uuid。
    const targetUuid = Object.keys(project.pbxNativeTargetSection()).find(
      (key) =>
        key.endsWith('_comment') === false &&
        String(project.pbxNativeTargetSection()[key].name).includes(TEST_TARGET),
    );
    if (!targetUuid) {
      throw new Error('withKitTests: 找不到新建的测试 target');
    }

    // 1) 先给 target 建 Sources phase——xcode 包 addTarget 建出来的 target
    //    buildPhases 是空的；不建的话 addSourceFile 会把文件塞进**第一个**
    //    匹配的 Sources phase（也就是 App target 的），测试文件就被编进 App 了。
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', targetUuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', targetUuid);

    // TEST_HOST 只设了路径，不构成显式依赖——不加这条，xcodebuild test 会
    // 在 App 二进制还没链接时就先链测试 bundle（实测：`library 'Memoh' not found`）。
    const appTargetUuid = Object.keys(project.pbxNativeTargetSection()).find(
      (key) =>
        key.endsWith('_comment') === false &&
        String(project.pbxNativeTargetSection()[key].name).replace(/^"|"$/g, '') === config.name,
    );
    if (appTargetUuid) {
      // xcode 包的 addTargetDependency 在 section 不存在时会静默跳过；
      // 这个工程没有 PBXContainerItemProxy（pods 用），先建空 section。
      const objects = project.hash.project.objects;
      objects.PBXContainerItemProxy = objects.PBXContainerItemProxy ?? {};
      objects.PBXTargetDependency = objects.PBXTargetDependency ?? {};
      project.addTargetDependency(targetUuid, [appTargetUuid]);
    }

    // 2) 源码直接编进测试 bundle（不用 pod 依赖，见文件头说明）
    const group = project.addPbxGroup([], TEST_TARGET, null);
    for (const rel of SOURCE_FILES) {
      const relFromIos = path.relative(iosRoot, path.join(mobileRoot, rel));
      project.addSourceFile(relFromIos, { target: targetUuid }, group.uuid);
    }

    // 3) hosted 测试的关键 build settings
    const configList =
      project.pbxXCConfigurationList()[
        project.pbxNativeTargetSection()[targetUuid].buildConfigurationList
      ];
    const confUuids = configList.buildConfigurations.map((entry) =>
      typeof entry === 'string' ? entry : entry.value,
    );
    for (const confUuid of confUuids) {
      const conf = project.pbxXCBuildConfigurationSection()[confUuid];
      Object.assign(conf.buildSettings, {
        GENERATE_INFOPLIST_FILE: 'YES',
        SWIFT_VERSION: '6.0',
        IPHONEOS_DEPLOYMENT_TARGET: '26.0',
        TEST_HOST: '"$(BUILT_PRODUCTS_DIR)/Memoh.app/Memoh"',
        BUNDLE_LOADER: '"$(TEST_HOST)"',
        TEST_TARGET_NAME: 'Memoh',
        PRODUCT_BUNDLE_IDENTIFIER: TEST_BUNDLE_ID,
        LD_RUNPATH_SEARCH_PATHS:
          '"$(inherited) @executable_path/Frameworks @loader_path/Frameworks"',
        FRAMEWORK_SEARCH_PATHS: '"$(inherited) $(PLATFORM_DIR)/Developer/Library/Frameworks"',
        OTHER_LDFLAGS: '"$(inherited) -framework XCTest"',
      });
      // addTarget 默认指向一个不存在的 Info.plist；用 GENERATE_INFOPLIST_FILE 代替。
      delete conf.buildSettings.INFOPLIST_FILE;
    }

    // 3) scheme：把幽灵 MemohTests 换成 MemohKitTests
    const schemePath = path.join(
      iosRoot,
      'Memoh.xcodeproj',
      'xcshareddata',
      'xcschemes',
      'Memoh.xcscheme',
    );
    rewriteTestables(schemePath, targetUuid);

    config.modResults = project;
    return config;
  });

module.exports = withKitTests;
