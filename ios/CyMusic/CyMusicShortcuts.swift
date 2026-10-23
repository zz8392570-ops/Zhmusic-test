import AppIntents
import Foundation

private let commandDefaultsSuite = "group.com.music.player.gyc"
private let pendingCommandKey = "cymusic.pendingSystemCommand"
private let commandNotification = Notification.Name("CyMusicSystemCommand")

@available(iOS 16.0, *)
private func dispatchCommand(_ command: String) {
  UserDefaults(suiteName: commandDefaultsSuite)?.set(command, forKey: pendingCommandKey)
  NotificationCenter.default.post(
    name: commandNotification,
    object: nil,
    userInfo: ["command": command]
  )
}

@available(iOS 16.0, *)
struct PlayZhMusicIntent: AudioPlaybackIntent {
  static var title: LocalizedStringResource = "播放音乐"
  static var description = IntentDescription("继续播放 ZhMusic 当前队列")
  static var openAppWhenRun: Bool { true }

  func perform() async throws -> some IntentResult {
    dispatchCommand("play")
    return .result()
  }
}

@available(iOS 16.0, *)
struct PauseZhMusicIntent: AudioPlaybackIntent {
  static var title: LocalizedStringResource = "暂停音乐"
  static var description = IntentDescription("暂停 ZhMusic")
  static var openAppWhenRun: Bool { true }

  func perform() async throws -> some IntentResult {
    dispatchCommand("pause")
    return .result()
  }
}

@available(iOS 16.0, *)
struct NextZhMusicIntent: AudioPlaybackIntent {
  static var title: LocalizedStringResource = "播放下一首"
  static var description = IntentDescription("播放 ZhMusic 队列中的下一首")
  static var openAppWhenRun: Bool { true }

  func perform() async throws -> some IntentResult {
    dispatchCommand("next")
    return .result()
  }
}

@available(iOS 16.0, *)
struct PlayFavoritesZhMusicIntent: AudioPlaybackIntent {
  static var title: LocalizedStringResource = "播放喜欢的歌曲"
  static var description = IntentDescription("在 ZhMusic 中播放喜欢的歌曲")
  static var openAppWhenRun: Bool { true }

  func perform() async throws -> some IntentResult {
    dispatchCommand("favorites")
    return .result()
  }
}

@available(iOS 16.0, *)
struct PlayPlaylistZhMusicIntent: AudioPlaybackIntent {
  static var title: LocalizedStringResource = "播放指定歌单"
  static var openAppWhenRun: Bool { true }
  @Parameter(title: "歌单") var playlist: MusicPlaylistEntity
  func perform() async throws -> some IntentResult {
    dispatchCommand("playlist:" + playlist.id)
    return .result()
  }
}

@available(iOS 16.0, *)
struct PlaySceneZhMusicIntent: AudioPlaybackIntent {
  static var title: LocalizedStringResource = "启动听歌场景"
  static var openAppWhenRun: Bool { true }
  @Parameter(title: "场景") var scene: MusicSceneEntity
  func perform() async throws -> some IntentResult {
    dispatchCommand("scene:" + scene.id)
    return .result()
  }
}

@available(iOS 16.0, *)
struct ZhMusicShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: PlayZhMusicIntent(),
      phrases: ["用 \(.applicationName) 播放音乐", "继续播放 \(.applicationName)"],
      shortTitle: "播放音乐",
      systemImageName: "play.fill"
    )
    AppShortcut(intent: PlayPlaylistZhMusicIntent(), phrases: ["用 \(.applicationName) 播放指定歌单"], shortTitle: "指定歌单", systemImageName: "music.note.list")
    AppShortcut(intent: PlaySceneZhMusicIntent(), phrases: ["启动 \(.applicationName) 听歌场景"], shortTitle: "听歌场景", systemImageName: "moon.fill")
    AppShortcut(
      intent: PauseZhMusicIntent(),
      phrases: ["暂停 \(.applicationName)"],
      shortTitle: "暂停音乐",
      systemImageName: "pause.fill"
    )
    AppShortcut(
      intent: NextZhMusicIntent(),
      phrases: ["让 \(.applicationName) 播放下一首"],
      shortTitle: "下一首",
      systemImageName: "forward.fill"
    )
    AppShortcut(
      intent: PlayFavoritesZhMusicIntent(),
      phrases: ["用 \(.applicationName) 播放我喜欢的歌曲"],
      shortTitle: "播放喜欢",
      systemImageName: "heart.fill"
    )
  }
}
