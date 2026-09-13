"""Unit tests for the scene case's scene-list parser.

这个解析器不解析 TypeScript——它只从 `scenes.ts` 里认出**顶层条目**的 id 与标题。
之所以值得单测：它出错的方式很隐蔽。若把帧里的 `id:` 也认成场景，这条 case 会去
打开 `scene-approval-1` 这种不存在的场景，结果是"跑过了但什么都没截到"，
或者截图里是一堆错误页——比直接失败更难查。
"""
import importlib.util
from pathlib import Path
import unittest

HERE = Path(__file__).parent


def load(name):
    spec = importlib.util.spec_from_file_location(f'memoh_scene_{name}', HERE / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SceneListTest(unittest.TestCase):
    def setUp(self):
        self.case = load('scenes')

    def test_finds_every_real_scene(self):
        found = dict(self.case.scene_ids())
        # 真实存在的场景必须在清单里。
        self.assertIn('chat-tools', found)
        self.assertIn('approval-no-options', found)
        # 标题要是人写的那个，不是 id 回退。
        self.assertNotEqual(found['chat-tools'], 'chat-tools')

    def test_ignores_identifiers_inside_frames(self):
        """帧里的 approval_id / run_id 不能被当成场景。"""
        found = set(dict(self.case.scene_ids()))
        for impostor in ('scene-approval-1', 'scene-approval-2', 'scene-run', 'scene-turn', 'scene-bot',
                         'allow_once', 'allow_always', 'reject_once', 'a1', 'a2'):
            self.assertNotIn(impostor, found, f'{impostor} 是帧里的 id，不该进场景清单')

    def test_every_scene_has_an_intent(self):
        """场景清单必须说明它验证什么，否则下一轮没人知道为什么留它。"""
        text = (HERE.parents[4] / 'apps/mobile/src/features/verify/scenes.ts').read_text(encoding='utf-8')
        # 缩进四个空格的才是条目里的字段；两个空格的是 Scene 接口的声明。
        self.assertEqual(text.count('\n    intent:'), len(self.case.scene_ids()))

    def test_every_scene_has_an_expectation(self):
        text = (HERE.parents[4] / 'apps/mobile/src/features/verify/scenes.ts').read_text(encoding='utf-8')
        self.assertEqual(text.count('\n    expect:'), len(self.case.scene_ids()))

    def test_scene_ids_are_unique_and_ocr_safe(self):
        """场景 id 要唯一，且是纯 ASCII。

        它是"确实切到了这个场景"的唯一判定依据（页头上以 `#<id>` 呈现），
        所以要唯一、要能被 Vision 稳定认出——中文标题做不到这点。
        """
        ids = [scene_id for scene_id, _ in self.case.scene_ids()]
        self.assertEqual(len(ids), len(set(ids)), f'场景 id 有重复：{ids}')
        for scene_id in ids:
            self.assertRegex(scene_id, r'^[a-z0-9-]+$', f'{scene_id} 不是纯 ASCII id')

    def test_fails_loudly_when_scenes_disappear(self):
        """找不到 SCENES 时说清楚原因，而不是静默返回空列表。"""
        original = self.case.SCENES
        try:
            self.case.SCENES = Path('/nonexistent/scenes.ts')
            with self.assertRaises(SystemExit):
                self.case.scene_ids()
        finally:
            self.case.SCENES = original


if __name__ == '__main__':
    unittest.main()
