import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { root } from './native-services-fixture.mjs'

if (process.platform !== 'darwin') throw new Error('Sound tap checks require macOS AVFoundation')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cymusic-sound-tap-'))
try {
	const binary = path.join(temporary, 'sound-tap')
	const compiled = spawnSync(
		'xcrun',
		[
			'clang',
			'-fobjc-arc',
			'-fmodules',
			'-Werror=implicit-function-declaration',
			'-fmodules-cache-path=' + path.join(temporary, 'modules'),
			'-I',
			path.join(root, 'modules/cymusic-native/ios'),
			path.join(root, 'scripts/fixtures/sound-tap-probe.m'),
			path.join(root, 'modules/cymusic-native/ios/CyMusicSoundDSP.m'),
			'-framework',
			'Foundation',
			'-framework',
			'AVFoundation',
			'-framework',
			'MediaToolbox',
			'-o',
			binary,
		],
		{ encoding: 'utf8', timeout: 60_000 },
	)
	if (compiled.status !== 0) throw new Error(compiled.error?.message || compiled.stderr)
	const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 30_000 })
	process.stdout.write(result.stdout || '')
	if (result.status !== 0) throw new Error(result.error?.message || result.stderr)
} finally {
	if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir()))
		throw new Error('Unexpected sound tap temporary directory')
	fs.rmSync(temporary, { recursive: true, force: true })
}
