import ExpoModulesCore
import Foundation
import WidgetKit

public final class CyMusicPersonalWidgetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CyMusicPersonalWidget")
    Function("updateSnapshot") { (snapshot: String) -> Bool in
      guard snapshot.utf8.count <= 256 * 1024,
        let data = snapshot.data(using: .utf8),
        (try? JSONSerialization.jsonObject(with: data)) is [String: Any],
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.music.player.gyc") != nil,
        let defaults = UserDefaults(suiteName: "group.com.music.player.gyc") else { return false }
      if defaults.string(forKey: "zhmusic.widgetSnapshot") != snapshot {
        defaults.set(snapshot, forKey: "zhmusic.widgetSnapshot")
        WidgetCenter.shared.reloadTimelines(ofKind: "ZhMusicQuickWidget")
      }
      return true
    }
  }
}
