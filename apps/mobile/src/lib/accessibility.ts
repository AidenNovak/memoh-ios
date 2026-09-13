/**
 * 无障碍：减少动效。
 *
 * ## 为什么必须做
 *
 * iOS 有个系统级开关「减弱动态效果」，前庭功能障碍的用户会因界面动效而眩晕。
 * Lody 把这条写成了硬规则：**每个动画路径都要查它并早退**。
 *
 * 我们目前的动效很少（列表出现、键盘、sheet），但**越少越容易漏**——因为不常写，
 * 写的时候想不起来这个开关。所以把它做成一个必须显式调用的 hook。
 *
 * ## 为什么自己写而不用 RN 自带的
 *
 * RN 0.76 起有 `useReducedMotion`，但**本项目用的 0.86.3 没有从主入口导出它**
 * （`Libraries/Components/AccessibilityInfo/AccessibilityInfo.js` 只有
 * `export default AccessibilityInfo`，没有具名 hook 导出）。查过再写，
 * 免得 import 一个不存在的符号在运行时才炸。
 *
 * 这里基于它确实有的两个东西实现：`AccessibilityInfo.isReduceMotionEnabled()`
 * （异步查询）与 `AccessibilityInfo.addEventListener('reduceMotionChanged', …)`
 * （运行时变化——用户在设置里切的时候要立刻生效，不能等下次启动）。
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * 当前是否要求减少动效。
 *
 * 初值是 `false`：系统查询是异步的，而"先按有动效渲染、再纠正"比反过来安全——
 * 反过来的话，默认真实值为 false 的用户会看到一次不该有的静态闪烁。
 */
export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduceMotion(enabled);
      })
      .catch(() => {
        // 查不到就当作"不要求减少动效"——这是系统的默认值。
      });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setReduceMotion(enabled);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

/**
 * 把一个动效时长按用户偏好收敛。
 *
 * 用法：`duration={motionDuration(reduceMotion, 250)}`。
 * 减少动效时返回 0 而不是直接跳过动画——跳过会让 `onAnimationEnd` 之类的回调
 * 永远不触发，那是个隐蔽的 bug。
 */
export function motionDuration(reduceMotion: boolean, milliseconds: number): number {
  return reduceMotion ? 0 : milliseconds;
}
