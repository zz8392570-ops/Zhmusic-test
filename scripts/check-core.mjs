import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const checks = [
	'check-download-naming.mjs',
	'check-file-downloads.mjs',
	'check-local-files.mjs',
	'check-lx-sync.mjs',
	'check-lx-auto-sync.mjs',
	'check-player-background.mjs',
	'check-public-playlists.mjs',
	'check-hot-search.mjs',
	'check-nested-track-list.mjs',
	'check-product-optimizations.mjs',
	'check-request-timers.mjs',
	'check-rntp-player.mjs',
	'check-search-playback.mjs',
	'check-sleep-timer.mjs',
	'check-source-host.mjs',
	'check-system-commands.mjs',
	'check-volume.mjs',
	'check-webdav-backup.mjs',
	'check-webdav-status.mjs',
	'check-health-and-logs.mjs',
]

for (const check of checks) {
	console.log(`\n> ${check}`)
	const result = spawnSync(process.execPath, [fileURLToPath(new URL(check, import.meta.url))], {
		stdio: 'inherit',
	})
	if (result.error) throw result.error
	if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log(`\n${checks.length} core check suites passed`)
