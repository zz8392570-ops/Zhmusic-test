import ExpoModulesCore
import UIKit

public final class CyMusicFileSharingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CyMusicFileSharing")

    AsyncFunction("shareFiles") { (paths: [String], promise: Promise) in
      let urls = paths.compactMap { value -> URL? in
        let url = value.hasPrefix("file://") ? URL(string: value) : URL(fileURLWithPath: value)
        guard let url, url.isFileURL, FileManager.default.fileExists(atPath: url.path) else {
          return nil
        }
        return url
      }

      guard !urls.isEmpty, urls.count == paths.count else {
        promise.reject("ERR_FILES_UNAVAILABLE", "One or more selected files are unavailable")
        return
      }
      guard let viewController = self.appContext?.utilities?.currentViewController() else {
        promise.reject("ERR_NO_VIEW_CONTROLLER", "Unable to present the system share sheet")
        return
      }

      let activityController = UIActivityViewController(activityItems: urls, applicationActivities: nil)
      if let popover = activityController.popoverPresentationController {
        popover.sourceView = viewController.view
        popover.sourceRect = CGRect(
          x: viewController.view.bounds.midX,
          y: viewController.view.bounds.maxY,
          width: 0,
          height: 0
        )
        popover.permittedArrowDirections = []
      }
      activityController.completionWithItemsHandler = { _, completed, _, error in
        if let error {
          promise.reject("ERR_SHARE_FAILED", error.localizedDescription)
        } else {
          promise.resolve(completed)
        }
      }
      viewController.present(activityController, animated: true)
    }
    .runOnQueue(.main)
  }
}
