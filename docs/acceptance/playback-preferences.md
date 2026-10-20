# Dislike rules and the independent play-later queue

## Behavior

- Song menus can add a song to play later, dislike a song, or dislike a credited artist. Settings provides both management screens, and the main playing-queue screen links to play later with its waiting count and current temporary song.
- Song rules match normalized title and complete artist credit across providers. Different titles, including Live/Remix labels, stay distinct. Artist rules match individual credited names, including collaborations, while retaining names such as AC/DC.
- Next, Previous, natural advancement, playback-error recovery, play-all and shuffle skip disliked choices. Manual song selection and tapping a play-later entry can still play a blocked song. Blocked pending entries remain available for manual selection. If no eligible song exists, automatic selection stops after one bounded search.
- Waiting temporary songs take priority after the current song and retain their own order. They never enter or reorder the base playlist. When they drain, playback returns after the original anchor; single-repeat returns to the original song. Previous during temporary playback returns to the base anchor. Removing the anchor preserves its surviving successor, including wraparound at the end of the base queue.
- The play-later screen can reorder/remove waiting entries and clear them after confirmation. Clearing waiting entries keeps the active temporary song. Explicitly selecting a base song or a new playlist retires the active temporary context and preserves waiting entries. Clearing all upcoming songs clears upcoming songs from both queues while allowing the active temporary song to finish.
- Saved temporary playback restores paused on startup. With startup playback restoration disabled, the interrupted temporary item returns to the front of the waiting queue. Dislike rules participate in settings backup; the session's play-later queue is stored locally. Library playlist sync keeps its existing data format.

## Automated checks

- `check-rntp-player.mjs` runs the production facade with controlled native/source seams: rule filtering and manual overrides, automatic playlist starts, independent queue draining, duplicate base/temporary identities, anchor removal/reordering, clear semantics, restart/restore-off, single-repeat, Previous, failed-platform recovery, late source cancellation and failed persistence writes.
- `check-playback-preferences.mjs` runs matching, exact-provider deduplication, bounded queue updates, backup validation, actual song-menu actions, and actual management screens including clear confirmations.
- `check-nested-track-list.mjs` checks that a temporary copy neither highlights nor hijacks selection of its matching base-queue row.
- Full validation includes lint, TypeScript and the existing core suites. iOS Hermes export verifies JavaScript packaging. Native playback is not established by these checks.

## iOS device acceptance

- [ ] Add songs from search, favorites and local music to play later. Open the queue summary and management screen, reorder/remove songs, and verify the active temporary song survives clearing waiting entries.
- [ ] Play A in a base queue A/B/C, enqueue T/U, and verify A → T → U → B → C. Repeat with T being the same provider/song as B and confirm only the active queue entry is highlighted.
- [ ] While T plays, remove A, move remaining base songs, switch repeat modes, and use the lock-screen/headset Next/Previous controls. Verify the return point, displayed title and playing state agree.
- [ ] Dislike songs and collaborators across providers. Verify natural advancement, play-all, shuffle and error recovery skip them; explicit taps still play them. Check the all-disliked case stops without cycling or repeated source requests.
- [ ] Force a temporary song's source/platform to fail; ensure recovery stays within that queue entry, then advances to the next eligible entry or base song once.
- [ ] Restart during temporary playback, then repeat with playback restoration disabled. Confirm paused restoration or pending-item recovery without inserting temporary songs into the base playlist.
- [ ] Export/restore a settings backup and confirm dislike rules survive; clear/remove rules and verify automatic playback includes those songs again.
