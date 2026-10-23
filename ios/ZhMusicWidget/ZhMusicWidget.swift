import SwiftUI
import WidgetKit
import Foundation

private let widgetSuite = "group.com.music.player.gyc"

struct QuickEntry: TimelineEntry {
  let date: Date
  let title: String
  let artist: String
  let collectionID: String
  let collectionName: String
  let chinese: Bool
}

struct QuickProvider: TimelineProvider {
  func placeholder(in context: Context) -> QuickEntry {
    QuickEntry(date: Date(), title: "ZhMusic", artist: "", collectionID: "favorites", collectionName: "我喜欢", chinese: true)
  }
  func getSnapshot(in context: Context, completion: @escaping (QuickEntry) -> Void) { completion(readEntry()) }
  func getTimeline(in context: Context, completion: @escaping (Timeline<QuickEntry>) -> Void) {
    completion(Timeline(entries: [readEntry()], policy: .after(Date().addingTimeInterval(1800))))
  }
  private func readEntry() -> QuickEntry {
    let defaults = UserDefaults(suiteName: widgetSuite)
    let data = defaults?.string(forKey: "zhmusic.widgetSnapshot")?.data(using: .utf8)
    let object = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any] ?? [:]
    let chinese = (object["language"] as? String ?? "zh").hasPrefix("zh")
    let selected = object["selected"] as? String ?? "favorites"
    let collections = object["collections"] as? [[String: Any]] ?? []
    let collection = collections.first { $0["id"] as? String == selected }
    return QuickEntry(date: Date(), title: object["title"] as? String ?? "ZhMusic", artist: object["artist"] as? String ?? "", collectionID: collection?["id"] as? String ?? "favorites", collectionName: collection?["name"] as? String ?? (chinese ? "我喜欢" : "Favorites"), chinese: chinese)
  }
}

private func musicLink(_ action: String, _ id: String? = nil) -> URL {
  var components = URLComponents()
  components.scheme = "zhmusic"
  components.host = "listen"
  components.queryItems = [URLQueryItem(name: "action", value: action)]
  if let id { components.queryItems?.append(URLQueryItem(name: "id", value: id)) }
  return components.url!
}

struct QuickWidgetView: View {
  let entry: QuickEntry
  @Environment(\.widgetFamily) private var family
  private func shortcut(_ title: String, icon: String, url: URL) -> some View {
    Link(destination: url) {
      VStack(spacing: 6) { Image(systemName: icon).font(.title3); Text(title).font(.caption2).lineLimit(1) }
        .foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 10)
        .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
    }
  }
  private var content: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(entry.title.isEmpty ? "ZhMusic" : entry.title).font(.headline).foregroundStyle(.white).lineLimit(1)
      if family != .systemSmall, !entry.artist.isEmpty { Text(entry.artist).font(.caption).foregroundStyle(.white.opacity(0.65)).lineLimit(1) }
      if family == .systemSmall {
        shortcut(entry.chinese ? "继续听" : "Resume", icon: "play.fill", url: musicLink("resume"))
      } else {
        HStack(spacing: 8) {
          shortcut(entry.chinese ? "继续听" : "Resume", icon: "play.fill", url: musicLink("resume"))
          shortcut(entry.collectionName, icon: "music.note.list", url: musicLink("playlist", entry.collectionID))
          shortcut(entry.chinese ? "我喜欢" : "Favorites", icon: "heart.fill", url: musicLink("favorites"))
        }
      }
    }.padding(family == .systemSmall ? 2 : 4)
  }
  var body: some View {
    if #available(iOS 17.0, *) {
      content.widgetURL(family == .systemSmall ? musicLink("resume") : nil).containerBackground(for: .widget) { Color(red: 0.08, green: 0.08, blue: 0.1) }
    } else { content.widgetURL(family == .systemSmall ? musicLink("resume") : nil).padding(12).background(Color(red: 0.08, green: 0.08, blue: 0.1)) }
  }
}

@main
struct ZhMusicQuickWidget: Widget {
  let kind = "ZhMusicQuickWidget"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: QuickProvider()) { entry in QuickWidgetView(entry: entry) }
      .configurationDisplayName("ZhMusic 快捷播放")
      .description("继续听、播放喜欢或指定歌单。请先在 ZhMusic 中选择桌面快捷歌单。")
      .supportedFamilies([.systemSmall, .systemMedium])
  }
}
