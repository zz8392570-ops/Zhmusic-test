# Favorite duplicate upgrade and explicit review

Existing installations previously loaded favorites without grouping historical duplicates. The first launch after this upgrade runs the conservative normalizer once and persists a local migration version. Complete, compatible cross-platform recordings are grouped; exact provider identities are deduplicated. A downloaded record's `originalId` identifies its remote source even if its local row ID was renamed to avoid a collision. Both rows share favorite heart state. This does not delete downloaded audio or local-library entries.

The favorites persistence owner retains the pre-change collection in library history. Failed writes expose the durable collection and retry on the next launch. Later explicit undo/history restoration is not automatically regrouped on every restart. Live/recording-version differences, duration gaps, imported local-only files and explicit splits retain their existing protection.

Missing-duration recordings and same-platform different IDs can now be manually reviewed. They default to unchecked, show platform, duration and album, and require both selection and a confirmation before merging. Safe and uncertain candidates do not overlap. The action still rechecks the latest collection before writing and supports undo. A notice on Favorites opens the duplicate manager when candidates remain.

New favorites also check for these uncertain matches before writing. The shared favorite action offers Add to existing, Keep separate and Cancel. Safe automatic matches and exact-ID removal retain their immediate behavior. An explicit separate choice is persisted, while a canceled/dismissed prompt writes nothing. Confirmation rechecks the target and preserves unrelated collection changes; stale targets and failed persistence never report success. The playlist picker waits for this action's completion before closing. Its navigation parameters retain special characters, original download IDs and separation choices.

`scripts/check-favorite-groups.mjs` exercises the actual library initializer, action owner and review screen: historical migration, failed data/flag writes and retries, original-ID download copies in either order, shared hearts, one-time migration, review opt-in and confirmation, version exclusions and undo. The complete core checks and iOS JavaScript/Hermes export are local validation; no device collection has been read or changed by these checks.

## Device acceptance

- [ ] Install over an existing collection without clearing data. Confirm complete compatible historical duplicates become one row and platform alternatives remain available.
- [ ] Check a downloaded copy and its remote favorite, including a renamed cache ID. Confirm one favorite, consistent hearts and offline playback; downloaded files remain in Local Music.
- [ ] For matching titles/artists with missing duration or different IDs on one platform, open the Favorites duplicate notice. Confirm they start unchecked, cancellation changes nothing, and selection plus confirmation merges them.
- [ ] Favorite two new matching results with different IDs on one platform, and two cross-platform results with a missing duration. The second heart must prompt before adding: Cancel changes nothing, Add to existing retains one row, and Keep separate retains two rows across restart.
- [ ] Repeat through the player, row heart, song menu and playlist picker. The picker must remain open after cancellation and close after a successful confirmation. Check artist/title values containing `&`/`#` and a downloaded copy with an `originalId`.
- [ ] Undo a manual merge, restart, and confirm it stays undone. Inspect library history for the pre-migration collection.
- [ ] Confirm Live, remix, materially different durations, imported local-only tracks and manually separated versions remain separate.
- [ ] Recheck the reported examples: 如果累了就回故乡（少年版） / 酷酷里、面妹孔佳奇 and 难得有情人 / 关淑怡. Their actual provider IDs, durations and version metadata determine whether automatic grouping or manual review applies.
