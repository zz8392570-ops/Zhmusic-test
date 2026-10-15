import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const compiler = process.env.CC || (process.platform === 'darwin' ? 'clang' : 'cc')
const available = spawnSync(compiler, ['--version'], { encoding: 'utf8', windowsHide: true })
if (available.error?.code === 'ENOENT' && process.platform === 'win32' && !process.env.CI) {
	console.log(
		'SKIP native sound DSP: no C compiler on this Windows host; macOS CI must run the probe.',
	)
	process.exit(0)
}
if (available.error || available.status !== 0) {
	throw new Error(`C compiler unavailable: ${available.error?.message || available.stderr}`)
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cymusic-sound-dsp-'))
try {
	const binary = path.join(temporary, process.platform === 'win32' ? 'sound-dsp.exe' : 'sound-dsp')
	const includes = path.join(root, 'modules/cymusic-native/ios')
	const source = path.join(includes, 'CyMusicSoundDSP.m')
	const probe = path.join(root, 'scripts/fixtures/sound-dsp-probe.c')
	const compiled = spawnSync(
		compiler,
		[
			'-x',
			'c',
			'-std=c11',
			'-O2',
			'-Wall',
			'-Wextra',
			'-Werror',
			'-I',
			includes,
			source,
			probe,
			'-lm',
			'-o',
			binary,
		],
		{ encoding: 'utf8', windowsHide: true, timeout: 60_000 },
	)
	if (compiled.error || compiled.status !== 0)
		throw new Error(
			`Native sound DSP compilation failed:\n${compiled.error?.message || compiled.stderr}`,
		)
	const result = spawnSync(binary, [], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
	process.stdout.write(result.stdout || '')
	if (result.error || result.status !== 0)
		throw new Error(`Native sound DSP probe failed:\n${result.error?.message || result.stderr}`)
} finally {
	const expectedParent = path.resolve(os.tmpdir())
	if (path.dirname(path.resolve(temporary)) !== expectedParent)
		throw new Error('Refusing cleanup outside the dedicated temporary directory')
	fs.rmSync(temporary, { recursive: true, force: true })
}
