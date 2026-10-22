# Backup selection feedback and preview

Selecting a valid backup previously updated a preview below the complete WebDAV configuration form, leaving the current viewport apparently unchanged. The shared preview and restore controls now appear directly after the file selection controls. Local selection and remote downloads reveal that area by scrolling to the top. File selection shows choosing/reading/ready feedback and explicitly says that restoring is a separate confirmation step.

The picker accepts JSON, text and generic binary MIME types; the existing full backup validator still decides what may be restored. A synchronous picker guard prevents rapid repeat presentations and overlapping WebDAV work. Cancellation preserves the existing preview, errors clear stale preview data, and returning from a picker/read after leaving the screen does not publish state or restore data. Native picker errors, file access errors and invalid/oversized backup data have distinct feedback. The uploaded reproduction backup passed the actual validator: 9 favorites, 2 playlists, 100 recent records. No uploaded personal data is committed to the repository.

`scripts/check-backup-import.mjs` renders the actual backup screen with the production backup parser/restore owner and mocked native picker/file boundaries. It checks preview/restore placement, selecting and reading states, duplicate presentation protection, cancellation, retries after errors, unmount during selection/read, remote preview reveal, and zero persistence writes before explicit restore confirmation.

## Device acceptance

- [ ] Open Backup and restore, select an exported JSON from On My iPhone and iCloud. After selection, the preview and restore choices should be visible beside the file controls. Downloading/reading cloud files should show feedback.
- [ ] Confirm the displayed filename and counts, choose merge or replace, and tap Restore backup. Cancellation changes no library data; confirmation applies the chosen operation.
- [ ] Cancel the file picker, retry, and tap repeatedly during opening. Only one picker should open and the controls should become available again after dismissal.
- [ ] Try invalid JSON and an unavailable cloud file. The screen should show an appropriate error and permit another selection.
- [ ] Select a WebDAV backup while viewing its controls near the bottom. Successful validation should reveal the same preview near the top.

Controlled checks and the iOS JavaScript export do not establish UIKit picker presentation or iCloud file access on a physical device.
