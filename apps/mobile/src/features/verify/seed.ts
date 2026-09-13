/**
 * 验收用的启动种子（仅开发构建）。
 *
 * ## 为什么需要它
 *
 * 验收要求"能在不登录的情况下跑"，但有些行为**只有连着真服务端才能验**——比如
 * 流式消息真的在屏幕上长出来。模拟器没有可脚本化的点击能力（`simctl` 没有 tap），
 * 靠键盘自动化去填表单既慢又脆。
 *
 * 所以走这条路：验收脚本往 App 的 Documents 里放一个 JSON，App 启动时读它，
 * 自动登录并执行一段固定的动作。被验证的是**真实路径**——真实网络、真实协议、
 * 真实的 reducer 与渲染——省掉的只有"手指点屏幕"这一段。
 *
 * ## 边界
 *
 * - **只在 `__DEV__` 下生效**。生产构建里 `loadVerifySeed()` 直接返回 null，
 *   这段代码的存在不影响任何用户。
 * - 种子文件只在 Documents 目录里，验收脚本用完即删。
 * - 种子里会有密码。它来自本机的 `~/.config/memoh-ios/dev.env`，写进模拟器的
 *   沙箱目录；不进仓库、不进日志、不上传。
 */
import { File, Paths } from 'expo-file-system';

const SEED_FILENAME = 'memoh-verify-seed.json';

export interface VerifySeed {
  /** 要连的服务器。 */
  baseUrl: string;
  username: string;
  password: string;
  /**
   * 登录后自动执行的动作。省略则只登录、停在首页。
   *
   *   - `chat`：用已有的第一个会话发一条消息（没有就新建）。走真实网络与协议。
   *   - `scene`：打开指定场景，用真实组件渲染固定帧序列。
   *     **不需要登录、也不连服务端**——这是设计迭代与视觉验收的入口。
   */
  scenario?: 'chat' | 'scene';
  /** `scenario: 'chat'` 时要发送的文本。 */
  message?: string;
  /** `scenario: 'scene'` 时要打开的场景 id（见 features/verify/scenes.ts）。 */
  scene?: string;
}

function isSeed(value: unknown): value is VerifySeed {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.baseUrl === 'string' &&
    typeof candidate.username === 'string' &&
    typeof candidate.password === 'string'
  );
}

/**
 * 读启动种子。没有、读不了、或不是生产允许的形状——一律返回 null。
 *
 * 这个函数**不抛异常**：验收基建出问题不该让 App 崩，那会把"基建坏了"伪装成
 * "App 坏了"。
 */
export function loadVerifySeed(): VerifySeed | null {
  // 生产构建里这段代码不执行。`__DEV__` 是 RN 在打包时注入的常量。
  if (!__DEV__) return null;

  try {
    const file = new File(Paths.document, SEED_FILENAME);
    if (!file.exists) return null;
    const parsed: unknown = JSON.parse(file.textSync());
    return isSeed(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 验收脚本应该在 App 启动前调用；这只是在 App 侧也能清掉。 */
export function clearVerifySeed(): void {
  if (!__DEV__) return;
  try {
    const file = new File(Paths.document, SEED_FILENAME);
    if (file.exists) file.delete();
  } catch {
    // 删不掉也不影响：下次启动还是同一份种子，验收等价。
  }
}

/**
 * 订阅种子文件里"要看哪个场景"的变化（仅开发构建）。
 *
 * ## 为什么需要这个
 *
 * 场景切换本来想用 deep link（`memoh:///debug/scene/<id>`），但 iOS 26 会对
 * `simctl openurl` 弹一个 "Open in Memoh?" 的系统确认框——而模拟器没法点它（这也
 * 是这个项目一直用脚本化动作代替手指的原因）。结果是每张截图都带着一个系统弹窗，
 * 而且场景根本切不过去。
 *
 * 改成读文件：验收脚本直接改 App 沙箱里的种子文件，App 轮询它。不需要点按、不需要
 * 冷启动（一次启动可以看完全部场景），切换也是确定的。
 *
 * 这个函数只在 `scenario === 'scene'` 时才被调用。
 */
export function watchVerifyScene(
  initial: VerifySeed,
  onChange: (sceneId: string) => void,
): () => void {
  if (!__DEV__) return () => {};
  let last = initial.scene ?? '';

  const timer = setInterval(() => {
    let next: unknown;
    try {
      const file = new File(Paths.document, SEED_FILENAME);
      if (!file.exists) return;
      const parsed: unknown = JSON.parse(file.textSync());
      if (parsed === null || typeof parsed !== 'object') return;
      next = (parsed as Record<string, unknown>).scene;
    } catch {
      return; // 读到半截的 JSON 很正常（脚本正在写），下一轮再看。
    }
    if (typeof next !== 'string' || next === last) return;
    last = next;
    onChange(next);
  }, 600);

  return () => clearInterval(timer);
}
