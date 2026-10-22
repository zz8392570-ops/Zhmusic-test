# Favorites reuse verified local audio before network resolution

Two controlled reproductions failed against the previous code: a favorite's cache badge found a quality-specific 320K file while playback, set to 128K, missed it; and a cross-platform favorite missed a file already reused by download deduplication. Local-library playback worked through its direct URI in both cases.

The playback resolver, cache badge and public cache check now share `getPlaybackCachedAudioInfo`. It checks the requested record at all available local qualities, then compatible favorite variants and registered cache records, including `originalId` aliases and custom filenames. Compatible records are indexed by immutable library snapshots, preserving existing version/duration/manual-split rules rather than matching a title alone. Files are checked on disk every playback attempt; missing files are not treated as available. A stale local favorite reference can recover through another verified cache copy. Imported local-only songs do not gain metadata-based links to remote favorites.

A verified local result wins before remote preloads, selected-source checks and source requests, even with no selected source. The requested favorite/queue identity and saved platform preference remain unchanged; the player reports the actual cached quality. Explicit download-quality rules remain separate. Cache display keys include duration, original IDs and linked local candidates so version/split and library changes can invalidate their display result.

Local Music and Cache Management now explain retention: both automatic cache and saved downloads can play offline while the file exists. Automatic cache participates in cleanup/storage limits; saved downloads are protected from automatic cache cleanup. Explicit deletion and uninstalling can still remove saved audio.

`scripts/check-offline-favorites.mjs` uses the actual cache manager, source resolver and player façade with dedicated real temporary files. It covers another-quality-only caches, cross-platform groups, original-ID/custom-name references, stale references, deletion, version/manual-split exclusions, remote-preload precedence, zero audio-source requests on a hit, and retained favorite queue slots. Existing download-quality/retention suites cover the separate download and cleanup policies.

## Device acceptance

- [ ] Install over the existing app without clearing data. Enable airplane mode and play the same downloaded song from Local Music and Favorites; both should play and show the actual cached quality.
- [ ] Repeat with only 320K/FLAC cached while the preferred quality is 128K, and with a favorite whose preferred platform differs from its saved cache platform. No source-retry/loading error should appear for an available file.
- [ ] Disable/remove the selected source and repeat. Existing local audio must still play; uncached songs may require networking/source configuration.
- [ ] Switch between favorite versions, including Live and manually separated versions. The app must not substitute an unrelated recording.
- [ ] Convert automatic cache using Keep offline, clear automatic cache, then repeat offline playback. Saved files must remain; deleted files must stop being reported available after refresh.
- [ ] Confirm queue Next/Previous, actual quality, restart and old download naming remain correct. Artwork/lyrics availability is separate from the local audio requirement.

Controlled checks and a JS export do not establish physical-device AVFoundation playback or filesystem migration behavior.
