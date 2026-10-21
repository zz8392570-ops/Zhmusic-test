# Song sharing from action menus

The custom action menu previously set its React Native Modal to hidden and immediately ran the selected action. On iOS, the native modal was still dismissing when `Share.share` attempted to present its activity controller. React Native's Fabric modal emits `onDismiss` from the UIKit dismissal completion; menu actions now wait for that event. The selected callback is captured at the tap, guarded against duplicate taps, and discarded if the menu unmounts. Android dispatch remains immediate because React Native only implements this dismissal event on iOS.

The player delegates sharing to `shareSong.ts`. Its share submenu separates song information, copying song/artist text, and explicitly sharing a local audio file. Song information uses validated platform detail links (QQ, NetEase, Kuwo, Kugou hash, or Migu copyright ID); pending/malformed/unsupported identifiers fall back to metadata. Playback URLs are never shared. Cached records retain their original provider ID for linking. On iOS, explicit file sharing resolves an owned local file before calling the existing native file-sharing module; unavailable files show a visible alert. Android includes a detail link in the message because its Share implementation ignores the separate URL field. Native errors allow retry; cancelling a sheet is not reported as a failure.

`scripts/check-song-sharing.mjs` executes the real menu and sharing owners with controlled React/native seams. It covers deferred and captured callbacks, duplicate events, submenu/disabled/cancel/unmount behavior, Android dispatch, content validation, cancellation/retry/error feedback, and the actual player callback/menu event wiring. These checks do not establish native UI presentation on a device.

## iOS device acceptance

- [ ] On the player page, open song options and tap Share. The menu disappears before the system share sheet appears.
- [ ] Share a network song, a cached/local song, and a song whose source is still loading. A platform detail link or song/artist text is available; temporary playback URLs never appear.
- [ ] Copy song/artist text. Explicitly share an imported or cached audio file, then repeat with a missing file and verify the visible error.
- [ ] Cancel and immediately try again; repeat with rapid taps. One sheet opens per selection, and cancellation leaves sharing available.
- [ ] Switch songs while the menu is closing. The selected share still uses the song from the selection.
- [ ] Verify menu actions that open an alert or route, such as add-to-playlist and custom sleep timer, still open after dismissal.
- [ ] Check presentation on iPhone and iPad, including landscape. Confirm share failure displays a visible error and a later retry succeeds.
