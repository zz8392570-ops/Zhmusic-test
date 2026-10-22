# Personal listening: favorite saves, offline coverage and start page

## Behavior

- Settings → Downloads and cache offers **Save new favorites offline** (off by default) and a separate 128K/320K/FLAC preference (320K default). Only successful explicit favorite additions trigger it. Startup, backup restore, synchronization and simply enabling the switch do not download existing favorites.
- Verified existing cache audio is retained at its actual quality without a network request; matching local-library rows change to saved. Otherwise the existing durable download queue saves the chosen quality over Wi-Fi/Ethernet only, independently of manual download settings. Failed tasks stay in download management. Switching networks pauses the work; disabling the option cancels unfinished favorite-triggered tasks and retains saved files. An explicit manual pause is respected. Unfavoriting does not delete saved audio.
- Favorites and personal playlists show verified offline counts. Checks include compatible provider variants and owned local files, run with four workers, and refresh on focus, foreground and cache/library changes. Unknown/unreadable files are not counted available. The offline filter applies to both rows and play/shuffle controls; multi-selection continues to operate on the full collection. This is an availability filter, not a global network prohibition: playback revalidates local files and retains normal recovery if a file later disappears.
- Save missing asks for quality and existing download confirmation. It rechecks the files after confirmation and queues only still-missing remote records from the selected snapshot. Local-only and unverifiable records are excluded. The count means playable local audio, including temporary automatic cache; it does not promise every file is permanently retained.
- Settings → General offers Charts (existing default), My Music, Favorites and Search as the next launch page. The redirect is consumed once after player/navigation readiness, only at the ordinary root route. Deep links and share-intent routes keep their destinations; returning to the foreground or changing settings does not navigate away.
- Favorite actions now report added, linked or removed only after persistence. Backup restoration reports resulting favorite/playlist/recent counts. New preferences participate in validated settings backup.

## Verification

`check-personal-listening.mjs` executes production download/cache owners with real temporary files and controlled network/native seams, plus actual summary/filter/hook owners with controlled React hooks. Coverage includes cellular gating, chosen quality, restart policy retention, cancellation, late network results, missing files, platform alternatives, bounded scans, stale UI work, confirmation-time rechecks and backup validation. Existing favorite, settings and playlist checks cover commit feedback and retained behavior.

## iOS device acceptance

- [ ] Enable favorite saving, choose 320K, favorite on Wi-Fi, and verify completion and actual quality in download management.
- [ ] Repeat on cellular, then reconnect Wi-Fi; verify waiting/resume. Switch away during a slow source request and during audio transfer.
- [ ] Favorite an already cached song while offline. Confirm no re-download, saved status, and survival after automatic-cache cleanup.
- [ ] Pause a download manually, favorite the song, and confirm it stays paused. Disable favorite saving with waiting/active tasks; confirm saved files remain.
- [ ] Open Favorites and an imported personal playlist; compare verified counts, offline filtering, play/shuffle and missing-song confirmation. Delete a file externally and return to the app.
- [ ] Cold launch to each start-page choice; test a deep link and a source share intent. Verify back navigation and no redirect when returning from background.
- [ ] Favorite, merge a duplicate, remove a favorite and restore a backup; verify accurate visible result messages without duplicate success toasts.

Linux checks do not establish native UIKit presentation, background transfer behavior or audible playback on a physical device.
