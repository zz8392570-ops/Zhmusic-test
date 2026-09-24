import fs from 'node:fs'
import path from 'node:path'
import { assert, checks, deferred, flush, loadModule, root } from './native-services-fixture.mjs'

const { check, finish } = checks()

const createFixture = ({
	currentMusic = { id: 'current' },
	favorites = [{ id: 'favorite' }],
	nextPromise,
} = {}) => {
	const pending = []
	const listeners = new Set()
	const calls = []
	const native = {
		takePendingCommand: () => pending.shift(),
		addListener(event, callback) {
			assert.equal(event, 'command')
			listeners.add(callback)
			return { remove: () => listeners.delete(callback) }
		},
	}
	const player = {
		getCurrentMusic: () => currentMusic,
		play: async () => calls.push('play'),
		pause: () => calls.push('pause'),
		skipToNext: async () => {
			calls.push('next')
			await nextPromise
		},
		playWithReplacePlayList: async (music, list) => calls.push(['favorites', music, list]),
	}
	const commands = loadModule('src/helpers/systemPlaybackCommands.ts', {
		'../../modules/cymusic-native/systemCommands': { __esModule: true, default: native },
		'@/store/library': { useLibraryStore: { getState: () => ({ favorites }) } },
		'./trackPlayerIndex': { __esModule: true, default: player },
		'./logger': { logInfo() {}, logError() {} },
	})
	return {
		...commands,
		calls,
		pending,
		listeners,
		emit(command) { listeners.forEach((listener) => listener({ command })) },
	}
}

await check('cold-start command is drained once after playback setup', async () => {
	const fixture = createFixture()
	fixture.pending.push('next')
	fixture.startSystemPlaybackCommands()
	fixture.startSystemPlaybackCommands()
	await flush()
	assert.deepEqual(fixture.calls, ['next'])
	assert.equal(fixture.listeners.size, 1)
	fixture.stopSystemPlaybackCommands()
})

await check('play resumes a current track and otherwise starts favorites', async () => {
	const resume = createFixture()
	resume.startSystemPlaybackCommands()
	resume.emit('play')
	await flush()
	assert.deepEqual(resume.calls, ['play'])
	resume.stopSystemPlaybackCommands()

	const favorites = [{ id: 'one' }, { id: 'two' }]
	const fresh = createFixture({ currentMusic: null, favorites })
	fresh.startSystemPlaybackCommands()
	fresh.emit('favorites')
	await flush()
	assert.equal(fresh.calls.length, 1)
	assert.equal(fresh.calls[0][0], 'favorites')
	assert.equal(fresh.calls[0][1], favorites[0])
	fresh.stopSystemPlaybackCommands()
})

await check('a command arriving during async handling is not lost', async () => {
	const gate = deferred()
	const fixture = createFixture({ nextPromise: gate.promise })
	fixture.startSystemPlaybackCommands()
	fixture.emit('next')
	fixture.pending.push('pause')
	fixture.emit('pause')
	await flush()
	assert.deepEqual(fixture.calls, ['next'])
	gate.resolve()
	await flush()
	assert.deepEqual(fixture.calls, ['next', 'pause'])
	fixture.stopSystemPlaybackCommands()
})

await check('native intents, module registration, and Xcode source membership stay wired', () => {
	const shortcut = fs.readFileSync(path.join(root, 'ios/CyMusic/CyMusicShortcuts.swift'), 'utf8')
	for (const value of ['PlayZhMusicIntent', 'PauseZhMusicIntent', 'NextZhMusicIntent', 'PlayFavoritesZhMusicIntent']) {
		assert.match(shortcut, new RegExp(`struct ${value}`))
	}
	assert.match(shortcut, /group\.com\.music\.player\.gyc/)
	const moduleConfig = JSON.parse(fs.readFileSync(path.join(root, 'modules/cymusic-native/expo-module.config.json'), 'utf8'))
	assert.ok(moduleConfig.apple.modules.includes('CyMusicSystemCommandsModule'))
	const project = fs.readFileSync(path.join(root, 'ios/CyMusic.xcodeproj/project.pbxproj'), 'utf8')
	assert.equal((project.match(/CyMusicShortcuts\.swift in Sources/g) ?? []).length, 2)
})

finish()
