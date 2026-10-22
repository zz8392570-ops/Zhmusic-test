# Favorite duplicate upgrade and explicit review

Existing installations previously loaded favorites without grouping historical duplicates. The first launch after this upgrade runs the conservative normalizer once and persists a local migration version. Complete, compatible cross-platform recordings are grouped; exact provider identities are deduplicated. A downloaded record's `originalId` identifies its remote source even if its local row ID was renamed to avoid a collision. Both rows share favorite heart state. This does not delete downloaded audio or local-library entries.

The favorites persistence owner retains the pre-change collection in library history. Failed writes expose the durable collection and retry on the next launch. Later explicit undo/history restoration is not automatically regrouped on every restart. Live/recording-version differences, duration gaps, imported local-only files and explicit splits retain their existing protection.

Missing-duration recordings and same-platform different IDs can now be manually reviewed. They default to unchecked, show platform, duration and album, and require both selection and a confirmation before merging. Safe and uncertain candidates do not overlap. The action still rechecks the latest collection before writing and supports undo. A notice on Favorites opens the duplicate manager when candidates remain.

`scripts/check-favorite-groups.mjs` exercises the actual library initializer, action owner and review screen: historical migration, failed data/flag writes and retries, original-ID download copies in either order, shared hearts, one-time migration, review opt-in and confirmation, version exclusions and undo. The complete core checks and iOS JavaScript/Hermes export are local validation; no device collection has been read or changed by these checks.

## Device acceptance

- [ ] Install over an existing collection without clearing data. Confirm complete compatible historical duplicates become one row and platform alternatives remain available.
- [ ] Check a downloaded copy and its remote favorite, including a renamed cache ID. Confirm one favorite, consistent hearts and offline playback; downloaded files remain in Local Music.
- [ ] For matching titles/artists with missing duration or different IDs on one platform, open the Favorites duplicate notice. Confirm they start unchecked, cancellation changes nothing, and selection plus confirmation merges them.
- [ ] Undo a manual merge, restart, and confirm it stays undone. Inspect library history for the pre-migration collection.
- [ ] Confirm Live, remix, materially different durations, imported local-only tracks and manually separated versions remain separate.
- [ ] Recheck the reported examples: 如果累了就回故乡（少年版） / 酷酷里、面妹孔佳奇 and 难得有情人 / 关淑怡. Their actual provider IDs, durations and version metadata determine whether automatic grouping or manual review applies.
