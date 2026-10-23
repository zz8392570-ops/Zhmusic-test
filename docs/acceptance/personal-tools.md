# Personal listening tools

## Implemented behavior

- **Smart shuffle** is opt-in in Settings → Playback. Every original queue entry remains exactly once. Recent listening lowers the chance of an early position; favorites not heard for 30 days, including never-heard favorites, have a higher weight. Stored favorite identities join platform history. Dislike filtering, temporary play-later handling and saved queue restoration retain their existing owners. Disabling the switch takes effect on the next shuffle.
- **Listening scenes** are available in My Music → Personal listening tools. Commute and Bedtime are editable defaults; users can save up to 20 scenes with a playlist, order, offline availability filter and 0–180 minute timer. Empty/deleted collections and native timer failure do not start playback. Cancellation, transport changes or library edits during offline scanning retire the old start. The offline filter checks available files; playback retains its existing local-first source recovery.
- **Tags** can be edited from a song's More actions menu and combined with all/any matching in the tag browser. There are at most 16 tags of 32 characters per recording. Downloaded source IDs and explicit favorite groups share tags; editing a group replaces its labels rather than leaving hidden labels on alternatives. Other songs remain separate.
- **Trip preparation** checks audio, lyrics and artwork independently, reports unknown audio states and prepares missing metadata over Wi-Fi. Preparing protects already-cached audio. Missing audio uses the existing quality/size confirmation and a durable per-task Wi-Fi restriction, including when upgrading an active task. Cancellation and switching away prevent late progress or lyric/cover writes. Lyrics and prepared artwork live under the app's media Documents tree; playback, rows and player artwork read them before online metadata. The default no-lyrics placeholder is never treated as prepared lyrics. Some providers have no lyrics or artwork. Recheck after preparation/downloads to see actual coverage.
- **Widgets** add small Resume and medium Resume/selected-playlist/Favorites choices. My Music → Personal listening tools selects the widget playlist. Widget taps open `zhmusic://listen` and resolve the current collection after playback setup. Existing Siri commands remain available; new AppIntents choose a playlist or scene by name from a bounded App Group snapshot. The snapshot contains names/counts/IDs and current display title/artist, never audio URLs, source scripts or credentials. WidgetKit controls refresh scheduling. A cold install must open the app before playlist/scene suggestions exist.
- New preferences participate in settings backup. Audio and prepared artwork/lyrics are files and are not included in JSON backup. Removing a favorite or scene does not delete saved audio.

## Verification

`check-personal-tools.mjs` executes weighted ordering, tag rules, scene actions, deep-link resolution, snapshot bounds, real-file metadata caching, cancellation, per-task Wi-Fi promotion and backup restoration. Existing player/queue and metadata suites remain regression coverage. Xcode project checks verify widget source membership, host dependency and embedding. CI adds an Apple-SDK typecheck for widget/AppIntents and verifies `ZhMusicWidget.appex` in the unsigned app.

The current Linux workspace cannot run Xcode or physical-device acceptance. JavaScript checks and an iOS Hermes export do not establish a successful native widget build, audible playback or iOS presentation. These remain pending in the triggered build and on the device.

## Device acceptance

- [ ] Turn smart shuffle on/off and start the same large playlist repeatedly. Check no omitted songs, lower recent-song frequency, lock-screen next/previous, play-later return and restart queue restoration.
- [ ] Save/edit/delete scenes. Run Commute without network and Bedtime with a short timer; pause or change songs during a slow offline scan and confirm it cannot later restart playback.
- [ ] Add labels through song menus, combine all/any filters, clear labels and split a favorite group. Confirm provider/local identities remain distinct as intended.
- [ ] Prepare a playlist on Wi-Fi, switch to cellular mid-fetch, cancel, retry and inspect unknown/missing items. Confirm active audio-task promotion waits for Wi-Fi and resumes after reconnect/restart.
- [ ] Enable airplane mode after preparation; play from Favorites and the original playlist, view lyrics and artwork, seek, lock the device and use headset controls. Automatic-cache cleanup must preserve protected audio.
- [ ] Install the new app with its Widget extension and shared App Group entitlements. Add small/medium widgets, change the selected playlist, test special-character names, and delete a previously selected playlist.
- [ ] In Shortcuts choose ZhMusic playlist/scene actions by displayed name. Test cold launch, foreground execution, missing collections and an empty queue; changing the start page must not override these destinations.
- [ ] Recheck backup file selection, explicit restore, duplicate favorite review, compact layouts, large text and VoiceOver on this build.
