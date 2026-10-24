# Personal data protection and everyday listening

- Backup merge unions song tags and merges scenes, dynamic tag playlists and dislike rules by ID. Existing scene/filter entries and lyric offsets win conflicts; ordinary preferences retain the explicit restore-settings behavior. The preview lists conflicting setting groups and personal-entry counts. Validation and merged size limits run before writes. Imports save one local recovery point first; failure to save it stops the import. Restore-before-import is explicit, confirmed, and keeps the state it replaces as the next recovery point. File backups still exclude audio and metadata files.
- Automatic WebDAV backup now debounces changes to every exported setting, including tags, scenes, lyric timing and dynamic playlists. Recovery-point and file-retention bookkeeping do not trigger it.
- Download management includes separate audio, lyric and artwork usage. Cleanup removes only recognized unretained metadata files; active writes, retained trip assets, unrelated files and audio stay intact. Trip preparation retains metadata independently of audio. The trip page can explicitly release the selected collection's metadata retention, including shared copies; cleanup remains a separate action.
- Settings → Playback → Offline playback only requires verified local audio before source lookup. Remote transport is retired when enabled, late remote resolutions cannot reach the native player, and native playback errors do not start source fallback. Local playback continues. Missing lyrics stay empty instead of starting a request. Downloads wait until the mode is disabled and keep their Wi-Fi policy. This is a playback policy: explicit online search and backups retain their own settings.
- Trip preparation has one primary entry with a selected audio quality and the existing size/space confirmation. After confirmation it rechecks the current collection, queues only approved missing audio identities, prepares missing metadata, then rechecks actual files. Task state changes refresh coverage while the page is active. Per-song missing metadata and failed-download details are visible. Cancellation/blur retires metadata work and later enqueue rights; already queued audio remains in download management. Metadata does not run as a background iOS service. Providers may not supply lyrics or artwork.
- Scene editing offers up to six pins on My Music. The pinned buttons use the same guarded scene owner. The active sleep countdown can be canceled from the homepage. Saved tag collections can be scene sources.
- The tag browser offers multi-select additive tagging, global tag rename and saved all/any filters. Renaming updates existing saved filters. Dynamic playlists resolve the current personal library whenever opened or played, appear on My Music, and can be deleted without deleting songs. Batch operations recheck identities before committing; data limits fail before writing.

## Verification

`check-personal-refinement.mjs` uses actual production helpers and temporary files for merge/undo/write failure, metadata accounting/retention, batch labels, dynamic filters, offline source and lyric behavior, download resumption and trip orchestration. Existing backup UI, automatic backup and native-player boundary suites cover integration. These controlled checks do not demonstrate iPhone audio output or UIKit behavior.

## Device acceptance still required

- [ ] Import an older backup with newer local tags/scenes. Compare merge vs replace previews and restore the recovery point.
- [ ] Toggle offline playback during an online song and a slow resolution; play prepared audio in airplane mode from favorites, a dynamic playlist, lock screen and headset controls.
- [ ] Prepare a collection, switch to cellular, leave/reopen, finish audio downloads and inspect the refreshed per-song coverage.
- [ ] Clear unretained metadata and verify retained lyrics/artwork and all audio remain. Release one collection and verify shared-retention messaging.
- [ ] Bulk tag, rename a tag used by a dynamic playlist, add another matching song, and start its pinned scene.
- [ ] Recheck existing widget/Shortcuts cold launch, sleep timer and background playback on the packaged build. Linux JavaScript validation cannot close these items.
