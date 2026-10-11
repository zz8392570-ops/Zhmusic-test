import { assert, checks, loadModule, flush } from './native-services-fixture.mjs'

const { check, finish } = checks()
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
	'@/helpers/logger': { logError() {}, logInfo() {} },
	'@/helpers/musicBackup': { createMusicBackup: () => ({}) },
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
finish()
