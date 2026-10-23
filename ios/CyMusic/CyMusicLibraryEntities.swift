import AppIntents
import Foundation

@available(iOS 16.0, *)
private func libraryEntries(_ key: String) -> [(String, String)] {
  guard let text = UserDefaults(suiteName: "group.com.music.player.gyc")?.string(forKey: "zhmusic.widgetSnapshot"),
    let data = text.data(using: .utf8),
    let snapshot = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
    let entries = snapshot[key] as? [[String: Any]] else { return [] }
  return entries.compactMap { entry in
    guard let id = entry["id"] as? String, !id.isEmpty, id.count <= 1024,
      let name = entry["name"] as? String else { return nil }
    return (id, name)
  }
}

@available(iOS 16.0, *)
struct MusicPlaylistEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "歌单"
  static var defaultQuery = MusicPlaylistQuery()
  var id: String
  var name: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

@available(iOS 16.0, *)
struct MusicPlaylistQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [MusicPlaylistEntity] {
    libraryEntries("collections").filter { identifiers.contains($0.0) }.map { MusicPlaylistEntity(id: $0.0, name: $0.1) }
  }
  func suggestedEntities() async throws -> [MusicPlaylistEntity] {
    libraryEntries("collections").map { MusicPlaylistEntity(id: $0.0, name: $0.1) }
  }
}

@available(iOS 16.0, *)
struct MusicSceneEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "听歌场景"
  static var defaultQuery = MusicSceneQuery()
  var id: String
  var name: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

@available(iOS 16.0, *)
struct MusicSceneQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [MusicSceneEntity] {
    libraryEntries("scenes").filter { identifiers.contains($0.0) }.map { MusicSceneEntity(id: $0.0, name: $0.1) }
  }
  func suggestedEntities() async throws -> [MusicSceneEntity] {
    libraryEntries("scenes").map { MusicSceneEntity(id: $0.0, name: $0.1) }
  }
}
