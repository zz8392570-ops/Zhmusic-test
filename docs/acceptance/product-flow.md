# Everyday music flows

- Tapping either the mini player's artwork or title opens Now Playing. Long-pressing the title retains the existing song-name search. Play/pause and queue controls keep their own actions.
- Common song actions stay at the top level. Current-queue edits, dislike rules, replacement, version management and splitting are under More actions. Queue labels explicitly say current queue; permanent playlist actions retain their playlist labels. Nested menus return one level at a time, and native actions still wait for iOS dismissal.
- Listening reports are available directly on My Music. Favorite version management is in the favorites collection's management menu and each grouped song's More actions. Play Later remains available in the player queue even with no waiting songs. These three redundant advanced-settings rows are removed.
- First-run setup opens a dedicated Import → Test and use → Search screen. Existing users can open the same screen from Settings → Sources. Local music import remains available without a source. Test success must be normal/partial and selection must finish before Search is enabled. Closing the screen cancels its right to select a late test result; changing the candidate requires another test.
- Settings and setup share the same import owners. File and URL imports share the busy guard; URL import uses the existing serialized batch pipeline, preserves duplicate handling, restores the playback runtime and releases progress on success/failure. This screen only imports sources supplied by the user.

Automated coverage executes the actual setup helper/screen and import owner, including failed/missing/partial sources, retry, concurrent taps, local navigation and dismissal during a pending test. Existing song-menu, download, favorite and playback checks cover retained actions; menu regression covers nested back navigation and deferred leaf dispatch.

## Device acceptance

- [ ] Tap the mini player artwork/title and verify both open Now Playing. Long-press the title to search; confirm play/pause and queue controls remain independent.
- [ ] Open More actions → Dislike, return to More actions, then to the root. Repeat with multi-artist menus; no action runs until a leaf is selected.
- [ ] Open reports from My Music, versions from favorites management, and Play Later from an empty/nonempty player queue.
- [ ] On a fresh install, import a file or URL, choose and test a source, then search and play. Verify source errors allow retry and partial availability is described accurately.
- [ ] Cancel file selection, import mixed valid/invalid files, import duplicates, and retry a failing URL. Progress clears and previous sources remain available.
- [ ] Leave setup while testing and confirm the late result does not switch the selected source. Return and test again.
- [ ] Use local import without any source, and verify setup remains accessible later in Settings. Check light/dark themes, large text, VoiceOver and iPad layouts.

Native presentation and third-party source availability require device verification; controlled checks and an iOS JS export do not establish those results.
