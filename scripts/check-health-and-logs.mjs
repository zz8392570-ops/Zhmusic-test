import fs from 'node:fs'
import path from 'node:path'
import { createStore } from 'zustand/vanilla'
import { assert, checks, loadModule, root } from './native-services-fixture.mjs'

const { check, finish } = checks()
const request = loadModule('src/helpers/requestControl.ts', {})
const health = loadModule('src/helpers/userApi/musicSourceHealth.ts', {
	'@/helpers/requestControl': request,
})

await check('logs retain only the newest 1000 entries with redacted bounded snapshots', () => {
	const logger = loadModule(
		'src/helpers/logger.ts',
		{ zustand: { createStore } },
		{ console: { log() {} } },
	)
	for (let i = 0; i < 1100; i++)
		logger.logInfo(`entry-${i}`, { url: 'https://example.test/?token=complete' })
	const logs = logger.useLogger.getState().logs
	assert.equal(logs.length, logger.MAX_LOG_ENTRIES)
	assert.match(logs[0].message, /^entry-100 /)
	assert.match(logs.at(-1).message, /^entry-1099 /)
	assert.doesNotMatch(logs.at(-1).message, /token=complete/)
	assert.equal(typeof logs.at(-1).details, 'string')
	assert.doesNotMatch(logs.at(-1).details, /complete/)
	logger.useLogger.getState().clearLogs()
	assert.equal(logger.useLogger.getState().logs.length, 0)
})

await check(
	'log snapshots handle cycles, bigint, getters and errors without retaining secrets',
	() => {
		const logger = loadModule(
			'src/helpers/logger.ts',
			{ zustand: { createStore } },
			{ console: { log() {} } },
		)
		let getterCalls = 0
		const input = { token: 'hidden-token', nested: { password: 'hidden-password' }, large: 1n }
		input.self = input
		Object.defineProperty(input, 'trap', {
			get() {
				getterCalls++
				throw new Error('getter')
			},
		})
		logger.logError(
			'https://user:password@example.test/song?key=hidden-query#hidden-fragment',
			input,
			new Error('request failed'),
		)
		const entry = logger.useLogger.getState().logs[0]
		assert.equal(getterCalls, 0)
		assert.match(entry.message, /Circular/)
		assert.match(entry.message, /request failed/)
		assert.doesNotMatch(entry.message, /hidden-|user:password/)
		input.token = 'mutated'
		assert.doesNotMatch(entry.details, /mutated/)
		assert.doesNotThrow(() => JSON.stringify(entry))
		logger.logInfo('x'.repeat(100000))
		assert.equal(
			logger.useLogger.getState().logs.at(-1).message.length,
			logger.MAX_LOG_MESSAGE_LENGTH,
		)
		logger.logInfo('Authorization: Bearer hidden-auth', {
			Authorization: 'hidden-header',
			cookie: 'hidden-cookie',
		})
		assert.doesNotMatch(logger.useLogger.getState().logs.at(-1).message, /hidden-/)
	},
)

await check(
	'samples prioritize artist/platform diversity and preserve platform IDs and metadata',
	() => {
		const songs = [
			...Array.from({ length: 8 }, (_, i) => ({
				id: `qq-${i}`,
				artist: 'A',
				title: `Song ${i}`,
				platform: 'tx',
			})),
			{ id: 'wy-id', artist: 'B', title: 'Other artist', platform: 'wy', albumId: 'album' },
			{ id: 'kw-id', artist: 'A', title: 'Other platform', platform: 'kw' },
		]
		const selected = health.selectHealthTestTracks(songs)
		assert.equal(selected.length, 8)
		assert.equal(selected[1], songs[8])
		assert.equal(selected[2], songs[9])
		assert.equal(
			health.selectHealthTestTracks(songs, false).every((s) => s.platform === 'tx'),
			true,
		)
	},
)

await check('quality fallback uses platform context and counts tracks, not attempts', async () => {
	const calls = []
	const result = await health.probeMusicApi(
		async (...args) => {
			calls.push(args)
			return args[3] === '320k' ? 'https://audio.example.test/song' : null
		},
		[{ title: 'Song', artist: 'Artist', id: 'real-platform-id', platform: 'wy' }],
	)
	assert.equal(result.successCount, 1)
	assert.equal(result.totalCount, 1)
	assert.equal(result.status, 'normal')
	assert.equal(result.qualitySupport['320k'], true)
	assert.equal(calls[1][4].platform, 'wy')
	assert.equal(calls[1][4].musicItem.id, 'real-platform-id')
})

await check(
	'network and catalog failures remain uncertain and eligible for playback retry',
	async () => {
		const tracks = [{ title: 'Song', artist: 'Artist', id: 'id', platform: 'tx' }]
		const network = await health.probeMusicApi(async () => {
			throw new Error('Network offline')
		}, tracks)
		const catalog = await health.probeMusicApi(async () => null, tracks)
		assert.equal(network.status, 'idle')
		assert.equal(network.lastProbeIssue, 'network')
		assert.equal(catalog.status, 'idle')
		assert.equal(catalog.lastProbeIssue, 'catalog')
		const candidates = health.getFailoverCandidates(
			[
				{ id: 'old', name: 'Old', health: { status: 'dead' } },
				{ id: 'ready', name: 'Ready', health: { status: 'normal' } },
			],
			'old',
		)
		assert.equal(candidates[0].id, 'ready')
		assert.equal(candidates[1].id, 'old')
		assert.equal(health.getFailoverCandidates(candidates, null, ['old']).length, 1)
	},
)

await check('production health runner probes personal catalog and persists results', async () => {
	const values = new Map([
		[
			'music.recentlyPlayed',
			[{ id: 'wy-real', title: 'Favorite', artist: 'Other artist', platform: 'wy' }],
		],
	])
	const state = (value) => ({
		getValue: () => value,
		setValue: (next) => {
			value = next
		},
	})
	const api = {
		id: 'fixture',
		name: 'Fixture',
		scriptType: 'lxmusic',
		health: { status: 'normal', runtimeSuccessCount: 3 },
	}
	const apiStore = state([api])
	const calls = []
	const controls = loadModule('src/helpers/userApi/musicApiControl.ts', {
		'@/utils/i18n': { t: (key) => key },
		'@/store/PersistStatus': {
			get: (key) => values.get(key) ?? null,
			set: (key, value) => values.set(key, value),
		},
		'@/helpers/requestControl': request,
		'@/player/PlayerStore': {
			musicApiStore: apiStore,
			musicApiSelectedStore: state(null),
			musicApiTestingStore: state(false),
			nowApiState: state(null),
		},
		'@/utils/utils': { showToast() {} },
		'@/utils/sourceSwitchNotice': { showAutomaticSourceSwitchNotice() {} },
		'react-native': { Alert: { alert() {} } },
		'../logger': { logInfo() {}, logError() {} },
		'./musicSourceHealth': health,
		'./lxMusicSourceAdapter': {
			isLxMusicScript: () => true,
			disposeLxMusicScript() {},
			reloadLxMusicScript: async (original) => ({
				...original,
				getMusicUrl: async (...args) => {
					calls.push(args)
					return 'https://example.test/audio'
				},
			}),
		},
	})
	await controls.testMusicApiById('fixture')
	assert.equal(calls.length, 8)
	assert.equal(calls[0][2], 'wy-real')
	assert.equal(calls[0][4].platform, 'wy')
	assert.equal(apiStore.getValue()[0].health.status, 'normal')
	assert.equal(apiStore.getValue()[0].health.runtimeSuccessCount, 3)
	assert.equal(values.get('music.musicApi')[0].health.successCount, 8)
})

await check('release versions and newly translated prompts stay consistent', () => {
	const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
	const version = JSON.parse(read('app.json')).expo.version
	assert.equal(JSON.parse(read('package.json')).version, version)
	assert.match(
		read('ios/CyMusic/Info.plist'),
		new RegExp(
			`CFBundleShortVersionString</key>\\s*<string>${version.replaceAll('.', '\\.')}</string>`,
		),
	)
	const versions = [
		...read('ios/CyMusic.xcodeproj/project.pbxproj').matchAll(/MARKETING_VERSION = ([\d.]+);/g),
	]
	assert.equal(versions.length, 4)
	assert.equal(
		versions.every((match) => match[1] === version),
		true,
	)
	const zh = JSON.parse(read('src/locales/zh.json'))
	const en = JSON.parse(read('src/locales/en.json'))
	for (const group of ['common', 'sourceImport', 'sourceErrors']) {
		assert.deepEqual(Object.keys(zh[group]).sort(), Object.keys(en[group]).sort())
	}
	const diagnostics = loadModule('src/helpers/userApi/sourceDiagnostics.ts', {
		'@/store/PersistStatus': {},
		'@/utils/i18n': { t: (key) => en.sourceErrors[key.split('.').at(-1)] },
	})
	assert.equal(diagnostics.getSourceErrorMessage('network'), en.sourceErrors.network)
})

finish()
