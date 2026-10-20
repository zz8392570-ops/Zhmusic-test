import ExpoModulesCore
import UIKit

public final class CyMusicFileSharingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CyMusicFileSharing")

    AsyncFunction("renderReportCard") { (title: String, lines: [String], promise: Promise) in
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1
      format.opaque = true
      let renderer = UIGraphicsImageRenderer(size: CGSize(width: 1080, height: 1440), format: format)
      let image = renderer.image { context in
        UIColor(red: 0.06, green: 0.08, blue: 0.15, alpha: 1).setFill()
        context.fill(CGRect(x: 0, y: 0, width: 1080, height: 1440))
        UIColor(red: 0.42, green: 0.78, blue: 0.70, alpha: 1).setFill()
        context.fill(CGRect(x: 64, y: 80, width: 96, height: 12))
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        (String(title.prefix(120)) as NSString).draw(in: CGRect(x: 64, y: 130, width: 952, height: 140), withAttributes: [
          .font: UIFont.systemFont(ofSize: 62, weight: .bold), .foregroundColor: UIColor.white, .paragraphStyle: paragraph
        ])
        for (index, line) in lines.prefix(10).enumerated() {
          (String(line.prefix(180)) as NSString).draw(in: CGRect(x: 64, y: CGFloat(320 + index * 90), width: 952, height: 78), withAttributes: [
            .font: UIFont.systemFont(ofSize: index == 0 ? 44 : 32, weight: index == 0 ? .semibold : .regular),
            .foregroundColor: UIColor(white: index == 0 ? 1 : 0.78, alpha: 1), .paragraphStyle: paragraph
          ])
        }
        ("ZhMusic" as NSString).draw(at: CGPoint(x: 64, y: 1320), withAttributes: [
          .font: UIFont.systemFont(ofSize: 32, weight: .semibold), .foregroundColor: UIColor.white
        ])
      }
      do {
        guard let data = image.pngData() else { throw NSError(domain: "ZhMusicReportCard", code: 1) }
        let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let url = directory.appendingPathComponent("listening-report-\(UUID().uuidString).png")
        try data.write(to: url, options: .atomic)
        promise.resolve(url.absoluteString)
      } catch { promise.reject("ERR_REPORT_CARD", error.localizedDescription) }
    }
    .runOnQueue(.main)

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
