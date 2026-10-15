import ExpoModulesCore

public final class CyMusicSoundEffectsModule: Module {
  private var processor: CyMusicSoundEffectsProcessor?

  public func definition() -> ModuleDefinition {
    Name("CyMusicSoundEffects")
    Events("soundEffectsChanged")

    AsyncFunction("configure") { (settings: [String: Any]) -> [String: Any] in
      if self.processor == nil {
        self.processor = CyMusicSoundEffectsProcessor(statusHandler: { [weak self] status in
          self?.emit(event: "soundEffectsChanged", payload: status)
        })
      }
      guard let processor = self.processor else {
        throw NSError(domain: "CyMusicSoundEffects", code: 1, userInfo: [
          NSLocalizedDescriptionKey: "Sound processor could not be created"
        ])
      }
      return processor.configure(
        enabled: settings["enabled"] as? Bool ?? false,
        bands: settings["bands"] as? [NSNumber] ?? [],
        volumeBalance: settings["volumeBalance"] as? Bool ?? false,
        revision: settings["revision"] as? Double ?? 0
      )
    }
    .runOnQueue(.main)

    OnDestroy {
      DispatchQueue.main.async {
        self.processor?.invalidate()
        self.processor = nil
      }
    }
  }
}
