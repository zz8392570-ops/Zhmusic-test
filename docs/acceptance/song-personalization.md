# Search library context, version details and per-song lyric timing

## Behavior

- Song search rows show exact favorite state and personal playlist membership. A favorite held only under a compatible search alternative is explicitly labeled as another platform version; its unselected heart retains its existing behavior. Membership uses platform/source IDs, cached `originalId` and stored groups, not title-only guesses. A shared immutable-playlist index avoids rescanning every playlist for every visible row.
- Remote rows show offline availability when the existing bounded cache lookup has verified audio. Persisted `cachedQuality` or a completed task alone cannot establish that label. The display lookup retains its existing short UI memoization; playback always rechecks the actual file. Local rows keep the existing owned-file checks and retention labels.
- Favorite version management shows recording title/alias, album, duration and verified local availability. Zero/invalid durations are unknown. The current default button is disabled. Successful default changes report persistence, stale/removed versions report a changed-data message, and failures report no success. Source-menu selection reports a saved preference separately from a playback failure; selecting an external search version does not implicitly save a favorite.
- Lyric +/- controls now write an absolute offset for the currently displayed platform recording. Online and downloaded records share `originalId`; other platform versions and local-only records remain separate. Existing global offsets remain the fallback for songs without a specific value. Reset writes zero for the current recording. The screen explains this scope and rejects a tap belonging to a song that has already changed.
- Offsets are limited to ±15 seconds and 5,000 bounded recording identities. They are included only when restoring personal settings. The parser caches the offset collection and reacts to storage updates, avoiding repeated collection decoding on progress events. Storage and native subscriptions retire during module disposal.

## Automated checks

`check-song-personalization.mjs` executes production offset rules, lyric manager/parser, player handler, collection index, labels, version screen and backup validation. It covers rapid updates, song changes, failed persistence, downloaded IDs, platform separation, restart, translated-line selection, bounded backup input and stale version choices. Existing search, source-menu and offline-label suites verify row wiring, cleared files and preference/playback feedback. These controlled JavaScript checks do not establish native UI layout or audible playback.

## iOS device acceptance

- [ ] Search an existing favorite and playlist song. Rename/remove the playlist and return to search; labels should update. Check an uncatalogued cover/Live result does not inherit membership.
- [ ] Search a grouped result whose other platform is favorited. Verify the explicit other-version label and existing favorite confirmation behavior.
- [ ] Search a downloaded song while offline. Confirm verified availability, then remove its file and revisit; never infer availability from quality metadata alone.
- [ ] Open Favorites → Management → Platform versions. Compare album/title/unknown duration and offline state; set a different default, restart and verify it remains selected.
- [ ] Select a version while its playback source is unavailable. Verify preference persistence and playback failure are reported separately.
- [ ] In the lyric screen adjust A by +1.5s, switch to B, return to A and restart. Verify A retains its value, B retains its own/default value, and translated lines remain aligned. Repeat with A's downloaded copy and another platform recording.
- [ ] Tap offset controls while rapidly switching songs; no previous song's tap may write to the new recording. Reset A, export/restore with and without settings, and confirm the corresponding timing survives.
- [ ] Inspect compact screens, large text and VoiceOver with the new row labels and lyric scope hint.
