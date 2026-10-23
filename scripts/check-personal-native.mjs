import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { root } from './native-services-fixture.mjs'
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zhmusic-personal-native-'))
try {
	const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], {
		encoding: 'utf8',
	}).trim()
	for (const files of [
		['ios/CyMusic/CyMusicLibraryEntities.swift', 'ios/CyMusic/CyMusicShortcuts.swift'],
		['ios/ZhMusicWidget/ZhMusicWidget.swift'],
	]) {
		const result = spawnSync(
			'xcrun',
			[
				'swiftc',
				'-typecheck',
				'-parse-as-library',
				'-swift-version',
				'5',
				'-target',
				'arm64-apple-ios16.4-simulator',
				'-sdk',
				sdk,
				'-module-cache-path',
				path.join(temporary, 'modules'),
				...files.map((file) => path.join(root, file)),
			],
			{ encoding: 'utf8' },
		)
		if (result.stdout) process.stdout.write(result.stdout)
		if (result.stderr) process.stderr.write(result.stderr)
		if (result.status !== 0) throw Error(`Apple SDK typecheck failed: ${files.join(', ')}`)
	}
	console.log(
		'PASS widget and AppIntents typecheck against the iOS SDK; device execution remains a manual check',
	)
} finally {
	fs.rmSync(temporary, { recursive: true, force: true })
}
