#!/usr/bin/env python3
"""从截图里量出配色：哪些颜色被用了、各占多少、分别落在哪些纵向区间。

## 为什么量而不是看

这个环境里的视觉模型读不了图，但"用户气泡和工具卡片是不是同一个灰底"这类问题
**不需要眼睛**——同一张图里相同的 RGB 就是同一个色。这正是层级混乱最常见的形态：
几种语义完全不同的东西长得一模一样，于是屏幕看上去平板、业余。

这个工具能回答的：

- 一张图里用了哪几种底色，各占多少像素；
- 每种底色出现在哪些纵向区间（于是能对上"这块是用户气泡，那块是工具卡片"）；
- 同一个颜色是否被用在了多处（**这就是"两种东西长一样"的证据**）。

它**不能**回答的（别指望它）：字号、间距是否一致、图标好不好看、文字有没有截断。
那些需要真看图。这个工具的定位是"给视觉评审提供不会撒谎的硬数据"，不是替代眼睛。

## 用法

    python3 ui/tools/measure_surfaces.py <screenshot.png> [--json] [--top N]
"""
import argparse
import json
import sys

try:
    from PIL import Image
    import numpy as np
except ImportError:  # pragma: no cover
    print('需要 pillow 与 numpy：python3 -m pip install pillow numpy', file=sys.stderr)
    raise SystemExit(2)

# 量化步长：把相近的颜色归成一类，避免抗锯齿产生成百上千个"颜色"。
QUANTUM = 4


def hex_of(rgb):
    return '#%02X%02X%02X' % (int(rgb[0]), int(rgb[1]), int(rgb[2]))


def quantize(rgb):
    return tuple((int(channel) // QUANTUM) * QUANTUM for channel in rgb)


def analyse(path, min_band=6, top_colors=8):
    image = Image.open(path).convert('RGB')
    pixels = np.asarray(image).astype(int)
    height, width, _ = pixels.shape

    # --- 配色清单 ---
    flat = [quantize(pixel) for pixel in pixels.reshape(-1, 3)]
    counts = {}
    for color in flat:
        counts[color] = counts.get(color, 0) + 1
    total = width * height
    palette = sorted(counts.items(), key=lambda item: -item[1])[:top_colors]
    colors = [
        {'color': hex_of(color), 'pixels': count, 'share': round(count / total, 4)}
        for color, count in palette
    ]

    # --- 每种主要颜色的纵向区间 ---
    bands = {}
    for color, _ in palette:
        mask = (np.abs(pixels - np.array(color)).max(axis=2) < QUANTUM)
        rows = mask.sum(axis=1)
        # 一行里这种颜色占到 12% 以上才算"这块是它的"——否则只是零星抗锯齿。
        present = rows > width * 0.12
        regions = []
        start = None
        for y in range(height + 1):
            here = y < height and present[y]
            if here and start is None:
                start = y
            elif not here and start is not None:
                if y - start >= min_band:
                    region = mask[start:y]
                    columns = np.where(region.any(axis=0))[0]
                    regions.append({
                        'top': start, 'bottom': y - 1, 'height': y - start,
                        'left': int(columns[0]) if columns.size else None,
                        'right': int(columns[-1]) if columns.size else None,
                    })
                start = None
        if regions:
            bands[hex_of(color)] = regions

    return {'path': str(path), 'width': width, 'height': height,
            'colors': colors, 'regions': bands}


def summarize(report, min_height=10):
    lines = [
        f"{report['path']}",
        f"  尺寸 {report['width']}x{report['height']}",
        '  配色（占比 / 出现区间）:',
    ]
    for entry in report['colors']:
        regions = [r for r in report.get('regions', {}).get(entry['color'], [])
                   if r['height'] >= min_height]
        spans = ', '.join(
            f"y{r['top']}-{r['bottom']}(h{r['height']} x{r['left']}..{r['right']})" for r in regions[:6]
        )
        more = f" +{len(regions) - 6}处" if len(regions) > 6 else ''
        lines.append(f"    {entry['color']}  {entry['share'] * 100:5.1f}%  {spans}{more}")
    return lines


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('screenshot')
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--top', type=int, default=8, help='报告前 N 种颜色')
    parser.add_argument('--min-height', type=int, default=10, help='忽略比这矮的区间')
    arguments = parser.parse_args(argv)

    report = analyse(arguments.screenshot, top_colors=arguments.top)
    if arguments.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        for line in summarize(report, arguments.min_height):
            print(line)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
