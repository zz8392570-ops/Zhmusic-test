import { createFixture } from './file-system-fixture.mjs'
import { assert, checks, loadModule, flush } from './native-services-fixture.mjs'

const { check, finish } = checks()
const policyFixture = createFixture()
const { isBackupDataKey } = policyFixture.runtime().load('src/helpers/musicBackup.ts')
const values = new Map()
const persist = {
	get: (key) => values.get(key) ?? null,
	set: (key, value) => values.set(key, value),
}
const status = loadModule('src/helpers/webDavBackupStatus.ts', { '@/store/PersistStatus': persist })
let foreground
let outcome = 'uploaded'
let calls = 0
const auto = loadModule('src/helpers/webDavAutoBackup.ts', {
	'@/store/PersistStatus': { subscribe: () => () => {} },
	'@/helpers/logger': { logError() {}, logInfo() {} },
	'@/helpers/musicBackup': { isBackupDataKey, createMusicBackup: () => ({}) },
	'@/helpers/webDavBackup': {
		runDailyWebDavBackup: async () => {
			calls++
			if (outcome instanceof Error) throw outcome
			return outcome
		},
	},
	'@/helpers/webDavBackupStatus': status,
	'expo-constants': { expoConfig: { version: '1.2.0' } },
	'react-native': {
		AppState: {
			currentState: 'active',
			addEventListener: (_event, callback) => {
				foreground = callback
				return { remove() {} }
			},
		},
	},
})

await check('successful automatic backup records time; skipped backup preserves it', async () => {
	const stop = auto.startWebDavAutoBackup()
	await flush()
	const time = values.get('backup.webdavStatus').lastSuccessAt
	assert.ok(time)
	outcome = 'skipped'
	foreground('background')
	foreground('active')
	await flush()
	assert.equal(values.get('backup.webdavStatus').lastSuccessAt, time)
	stop()
})

await check('failures survive restart and success clears error and failure count', async () => {
	outcome = Object.assign(new Error('unauthorized'), { code: 'unauthorized' })
	const stop = auto.startWebDavAutoBackup()
	await flush()
	assert.equal(values.get('backup.webdavStatus').errorCode, 'unauthorized')
	assert.ok(values.get('backup.webdavStatus').lastSuccessAt)
	foreground('background')
	foreground('active')
	foreground('background')
	foreground('active')
	await flush()
	assert.equal(values.get('backup.webdavStatus').failureCount, 2)
	assert.equal(calls, 4)
	outcome = 'uploaded'
	foreground('background')
	foreground('active')
	await flush()
	assert.equal(values.get('backup.webdavStatus').failureCount, 0)
	assert.equal(values.get('backup.webdavStatus').errorCode, undefined)
	stop()
})
function autoFixture() {
	let listener,
		foreground,
		changed = 0,
		calls = 0
	const timers = new Map()
	let nextTimer = 0
	let pending
	const api = loadModule(
		'src/helpers/webDavAutoBackup.ts',
		{
			'@/store/PersistStatus': {
				subscribe(callback) {
					listener = callback
					return () => {
						listener = undefined
					}
				},
			},
			'@/helpers/logger': { logError() {}, logInfo() {} },
			'@/helpers/musicBackup': { isBackupDataKey, createMusicBackup: () => ({ changed }) },
			'@/helpers/webDavBackup': {
				runDailyWebDavBackup: async () => {
					calls++
					if (pending) await pending.promise
					return 'uploaded'
				},
			},
			'@/helpers/webDavBackupStatus': {
				recordWebDavBackupSuccess() {},
				recordWebDavBackupFailure() {},
			},
			'expo-constants': { expoConfig: {} },
			'react-native': {
				AppState: {
					currentState: 'active',
					addEventListener(_event, callback) {
						foreground = callback
						return { remove() {} }
					},
				},
			},
		},
		{
			setTimeout(callback, delay) {
				assert.equal(delay, 15000)
				const id = ++nextTimer
				timers.set(id, callback)
				return id
			},
			clearTimeout: (id) => timers.delete(id),
		},
	)
	return {
		...api,
		timers,
		get calls() {
			return calls
		},
		change(key = 'music.playLists') {
			changed++
			listener?.(key)
		},
		foreground: (state) => foreground(state),
		hold: (value) => {
			pending = value
		},
		fire() {
			const [id, callback] = [...timers][0]
			timers.delete(id)
			callback()
		},
	}
}
await check(
	'library changes debounce into one backup and unrelated writes do not trigger it',
	async () => {
		const h = autoFixture(),
			stop = h.startWebDavAutoBackup()
		await flush()
		h.change('music.progress')
		assert.equal(h.timers.size, 0)
		h.change()
		h.change('music.favorites')
		h.change()
		assert.equal(h.timers.size, 1)
		h.fire()
		await flush()
		assert.equal(h.calls, 2)
		stop()
	},
)
await check(
	'changes during upload schedule a following backup; background changes wait for foreground',
	async () => {
		const h = autoFixture(),
			stop = h.startWebDavAutoBackup()
		await flush()
		let resolve
		const pending = {
			promise: new Promise((done) => {
				resolve = done
			}),
		}
		h.hold(pending)
		h.change()
		h.fire()
		await flush()
		h.change()
		resolve()
		await flush()
		h.hold(undefined)
		assert.equal(h.timers.size, 1)
		h.fire()
		await flush()
		assert.equal(h.calls, 3)
		h.foreground('background')
		h.change()
		assert.equal(h.timers.size, 0)
		h.foreground('active')
		await flush()
		assert.equal(h.calls, 4)
		h.change()
		stop()
		assert.equal(h.timers.size, 0)
		h.change()
		assert.equal(h.timers.size, 0)
	},
)
await check(
	'personal tags, scenes, lyric timing and dynamic filters trigger debounced automatic backup',
	async () => {
		const h = autoFixture(),
			stop = h.startWebDavAutoBackup()
		await flush()
		for (const key of [
			'music.trackTags',
			'music.listeningScenes',
			'lyric.trackOffsets',
			'music.tagCollections',
		])
			h.change(key)
		assert.equal(h.timers.size, 1)
		h.fire()
		await flush()
		assert.equal(h.calls, 2)
		h.change('backup.restorePoint')
		assert.equal(h.timers.size, 0)
		stop()
	},
)
await policyFixture.dispose()
finish()
