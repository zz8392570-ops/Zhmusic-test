# Player startup, resolution and library storage

## Automated coverage

- `scripts/check-rntp-player.mjs`: a broken restored source cannot block queue/local-library restoration or listener setup; platform attempts share a 20-second budget; manual retry gets a fresh budget; progress-driven preload follows queue changes and playback intent; retired auto-cache callbacks cannot enqueue after a delayed network check.
- `scripts/check-product-optimizations.mjs`: concurrent preloads share one request; cancellation aborts requests and prevents late refill; expired URLs are refreshed; source/quality changes cannot reuse the previous entry.
- `scripts/check-library-tools.mjs`: legacy collections/history remain readable; first edits migrate storage; unchanged chunks are reused; chunk/history/live-manifest failures roll back; restart reads preserve metadata; interrupted cleanup preserves published chunks; count/size retention removes unreferenced chunks; recovery still creates a redo point.

Favorites and each playlist use immutable blocks of up to 128 songs. Recovery manifests reference the same blocks. Public persistence reads still return complete arrays, so backup, sync and recovery keep their existing formats. History retains up to 20 entries from the last 30 days, with an approximate 8 MiB serialized-character budget for unique history chunks and metadata (the newest complete recovery point is retained even if it alone exceeds the budget). Failed commits restore the previous manifests. A cleanup journal allows a later write to remove orphaned chunks after an interrupted operation without removing published data.

## Development benchmark

Node, in-memory MMKV seam, 10,000 songs, 8 edits to the first song's title; median of the last 5 writes. Comparison against `e1b5d09`; these are **not phone timings**. Storage/write sizes count serialized characters, matching the history budget, rather than physical MMKV file bytes.

| Measurement | Before | After |
| --- | ---: | ---: |
| Median write | 142.5 ms | 8.3 ms |
| Total serialized writes across 8 edits | 47.07 MiB | 0.31 MiB |
| Retained serialized storage after edits | 8.76 MiB | 1.24 MiB |
| Complete recovery points | 7 | 8 |

## iOS device acceptance

- [ ] Restore an invalid selected source together with saved queues and local/cache songs. The app shows the source error, restores the queue, and still plays local/cache songs.
- [ ] Try a favorite with several unavailable platform variants. Loading ends within one approximately 20-second resolution window; retry works and cancellation remains responsive.
- [ ] Play a remote song on Wi-Fi. Preloading begins near the last 10 seconds. Skip, reorder, clear upcoming songs, pause or stop during a pending request; no retired result replaces the selected song or refills the retired preload.
- [ ] Enable the Wi-Fi-only background policy, switch to cellular, and confirm progress does not start a background preload. Local/cache playback and single-repeat mode do not preload another song.
- [ ] Upgrade an existing library with imported playlist metadata and recovery history. Edit a song, restart, export/import a backup, sync, then restore a historical version; songs, alternatives, artwork and playlist metadata remain complete.
- [ ] Edit a large library on a device and confirm scrolling remains usable. Remove old history and restart to verify current collections remain intact.

Linux checks cover the JavaScript owners and iOS Hermes export. Native playback, on-device latency and iOS background scheduling require the device checks above.
