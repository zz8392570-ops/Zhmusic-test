# Library tools acceptance

New entry points are in Settings → Advanced: Repair unavailable songs, Manage platform versions, Library history and recovery, Playback diagnostics, and Listening report. Song menus also link to platform management. Download deduplication can be overridden for manual downloads in the cache manager.

Automated checks: `npm run validate` runs the production JavaScript owners with controlled storage, source and native transport seams. `expo export --platform ios` checks bundling and Hermes generation. These checks do not establish audible playback or UIKit behavior on a device.

Native checks require macOS/Xcode: `npm run check:native`. The Linux workspace cannot run them. The following device checks remain unchecked until performed on the current build:

- [ ] Scan favorites and an imported playlist. Cancel during a network request, reopen, select only one proposed replacement, and confirm. Unchecked, removed and manually edited songs must remain unchanged.
- [ ] Refresh/sync a playlist and preview its history. Verify additions, removals, metadata and order; restore it, then recover the version from before restoration. Another playlist must remain unchanged.
- [ ] Change a default platform; remove a wrong version and restore it from history. The last version must not be removable through version management. Cached files must remain intact.
- [ ] Download two equivalent platform versions concurrently at the same quality. Only one file should be written. A quality upgrade, a Live recording, an explicit split, or enabling manual platform copies must retain the intended separate file.
- [ ] Play continuously through at least three tracks. Check foreground/background, lock-screen Next/Previous, headset controls, interruption/resume and stopping during source resolution.
- [ ] Disconnect networking or use a failing platform. Check a bounded platform fallback, playback position, the original queue slot, diagnostic entries and cancellation after selecting another song. The saved default platform must not change.
- [ ] Select weekly, monthly and annual reports and previous periods. Check record coverage and streaks. Share a PNG card through the iPhone and iPad system share sheets; cancel and repeat. Temporary card files should be removed after sharing ends.

History is local, contains records rather than audio, and retains at most 20 snapshots for 30 days with an approximate 8 MiB history budget (the newest recovery point is retained even if larger). Annual reports use available device records only. Existing expired daily data cannot be reconstructed; retention increases to 400 recorded dates for future writes.
