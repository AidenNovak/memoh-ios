// 截图文字读取：把一张 Simulator 截图里的文字取出来（宿主 macOS 上运行）。
//
// 验证基建刻意不引入 Appium / Detox / AXe 这类依赖：截图 + 录屏是证据，文字读
// 取只用来断言"用户能看到的文案"。Vision 是系统框架，不需要装任何东西。
//
// 用法：textdump <screenshot.png> > lines.json
// 输出：{"text": "...", "lines": [{"text": ..., "confidence": ...}, ...]}
import CoreGraphics
import Foundation
import ImageIO
import Vision

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("textdump: \(message)\n".utf8))
    exit(1)
}

let arguments = CommandLine.arguments
guard arguments.count > 1 else {
    fail("usage: textdump <screenshot.png>")
}

let url = URL(fileURLWithPath: arguments[1])
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fail("cannot read image at \(url.path)")
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
// 不做语言纠正：验证要的是"屏幕上确实印着这串字"，纠正会掩盖拼写错误。
request.usesLanguageCorrection = false
if let languages = try? request.supportedRecognitionLanguages() {
    let wanted = ["en-US", "zh-Hans"]
    let available = wanted.filter { languages.contains($0) }
    if !available.isEmpty {
        request.recognitionLanguages = available
    }
}

let handler = VNImageRequestHandler(cgImage: image, options: [:])
do {
    try handler.perform([request])
} catch {
    fail("recognition failed: \(error)")
}

var lines: [[String: Any]] = []
for observation in request.results ?? [] {
    guard let candidate = observation.topCandidates(1).first else { continue }
    lines.append(["text": candidate.string, "confidence": Double(candidate.confidence)])
}

let payload: [String: Any] = [
    "text": lines.compactMap { $0["text"] as? String }.joined(separator: "\n"),
    "lines": lines,
]
guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
      let output = String(data: data, encoding: .utf8) else {
    fail("cannot serialise result")
}
print(output)
