import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
	console.error('Native checks require macOS and Xcode.')
	process.exit(1)
}

const checks = [
	'check-native-services.mjs',
	'check-rntp-precise-seeking.mjs',
	'check-rntp-remote-native.mjs',
	'check-source-runtime.mjs',
	'check-volume-native.mjs',
]

for (const check of checks) {
	console.log(`\n> ${check}`)
	const result = spawnSync(process.execPath, [fileURLToPath(new URL(check, import.meta.url))], {
		stdio: 'inherit',
	})
	if (result.error) throw result.error
	if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log(`\n${checks.length} native check suites passed`)
