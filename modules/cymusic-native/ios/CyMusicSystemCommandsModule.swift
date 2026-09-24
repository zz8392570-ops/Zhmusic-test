import ExpoModulesCore
import Foundation

private let commandDefaultsSuite = "group.com.music.player.gyc"
private let pendingCommandKey = "cymusic.pendingSystemCommand"
private let commandNotification = Notification.Name("CyMusicSystemCommand")

public final class CyMusicSystemCommandsModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("CyMusicSystemCommands")
    Events("command")

    Function("takePendingCommand") { () -> String? in
      let defaults = UserDefaults(suiteName: commandDefaultsSuite)
      let command = defaults?.string(forKey: pendingCommandKey)
      defaults?.removeObject(forKey: pendingCommandKey)
      return command
    }

    OnStartObserving {
      guard self.observer == nil else { return }
      self.observer = NotificationCenter.default.addObserver(
        forName: commandNotification,
        object: nil,
        queue: .main
      ) { [weak self] notification in
        guard let command = notification.userInfo?["command"] as? String else { return }
        self?.sendEvent("command", ["command": command])
      }
    }

    OnStopObserving {
      self.removeObserver()
    }

    OnDestroy {
      self.removeObserver()
    }
  }

  private func removeObserver() {
    if let observer {
      NotificationCenter.default.removeObserver(observer)
      self.observer = nil
    }
  }
}
