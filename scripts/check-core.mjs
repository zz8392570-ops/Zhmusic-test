import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const checks = [
	'check-file-downloads.mjs',
	'check-local-files.mjs',
	'check-lx-sync.mjs',
	'check-lx-auto-sync.mjs',
	'check-player-background.mjs',
	'check-product-optimizations.mjs',
	'check-request-timers.mjs',
	'check-rntp-player.mjs',
	'check-search-playback.mjs',
	'check-sleep-timer.mjs',
	'check-source-host.mjs',
	'check-volume.mjs',
	'check-webdav-backup.mjs',
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
