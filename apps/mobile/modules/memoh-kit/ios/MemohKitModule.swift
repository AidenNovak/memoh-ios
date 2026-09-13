import ExpoModulesCore

public final class MemohKitModule: Module, @unchecked Sendable {
  public func definition() -> ModuleDefinition {
    Name("MemohKit")
    View(NativeMessageList.self) {
      Events("onReachTop")
      Prop("turnsJson") { (view: NativeMessageList, value: String) in
        view.setTurnsJSON(value)
      }
      Prop("emptyTitle") { (view: NativeMessageList, value: String) in
        view.emptyTitle = value
      }
      Prop("emptyBody") { (view: NativeMessageList, value: String) in
        view.emptyBody = value
      }
    }
  }
}
