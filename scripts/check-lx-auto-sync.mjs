import { assert, checks, deferred, flush, loadModule } from './native-services-fixture.mjs'

const { check, finish } = checks()

function fixture({ syncResult } = {}) {
	const disk = new Map()
	const timers = new Map()
	let nextTimerId = 1
	let appState = 'active'
	let networkState = { type: 'WIFI', isConnected: true, isInternetReachable: true }
	let appListener
	let networkListener
	let credentials = { serverId: 'server', keyInfo: { clientId: 'client', key: 'key', serverName: 'LX' } }
	let credentialsError
	const syncCalls = []
	const persist = {
		get: (key) => disk.get(key) ?? null,
		set: (key, value) => {
			if (value === undefined) disk.delete(key)
			else disk.set(key, value)
		},
	}
	const AppState = {
		get currentState() {
			return appState
		},
		addEventListener(_event, listener) {
			appListener = listener
			return { remove: () => { appListener = undefined } }
		},
	}
	const NetworkStateType = { NONE: 'NONE', WIFI: 'WIFI', ETHERNET: 'ETHERNET', CELLULAR: 'CELLULAR' }
	const network = {
		NetworkStateType,
		getNetworkStateAsync: async () => networkState,
		addNetworkStateListener(listener) {
			networkListener = listener
			return { remove: () => { networkListener = undefined } }
		},
	}
	const setTimeoutFake = (callback, delay) => {
		const id = nextTimerId++
		timers.set(id, { callback, delay })
		return id
	}
	const clearTimeoutFake = (id) => timers.delete(id)
	const scheduler = loadModule(
		'src/helpers/sync/lxAutoSync.ts',
		{
			'@/store/PersistStatus': persist,
			'expo-network': network,
			'react-native': { AppState },
			'./lxSyncCredentials': {
				getLxSyncCredentials: async () => {
					if (credentialsError) throw credentialsError
					return credentials
				},
			},
			'./lxSyncClient': {
				syncWithLxServer: async (options) => {
					syncCalls.push(options)
					if (syncResult) return syncResult()
					return { serverName: 'LX' }
				},
			},
		},
		{ Error, setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake },
	)
	return {
		...scheduler,
		disk,
		persist,
		syncCalls,
		timers,
		setCredentials: (value) => { credentials = value },
		setCredentialsError: (value) => { credentialsError = value },
		setNetwork: (value) => { networkState = value },
		emitNetwork: (value) => networkListener?.(value),
		emitAppState: (value) => {
			appState = value
			appListener?.(value)
		},
		runNextTimer: () => {
			const next = [...timers.entries()].sort((left, right) => left[1].delay - right[1].delay)[0]
			if (!next) return false
			timers.delete(next[0])
			next[1].callback()
			return true
		},
	}
}

const configure = (h) => {
	h.persist.set('sync.autoEnabled', true)
	h.persist.set('sync.host', 'http://192.168.1.2:9527')
}

await check('automatic sync requires opt-in, a host, credentials and a usable network', async () => {
	const h = fixture()
	h.requestLxAutoSync()
	await flush()
	assert.equal(h.syncCalls.length, 0)
	configure(h)
	h.setCredentials(null)
	h.requestLxAutoSync()
	await flush()
	assert.equal(h.syncCalls.length, 0)
	h.setCredentials({ serverId: 'server', keyInfo: { clientId: 'client', key: 'key', serverName: 'LX' } })
	h.setNetwork({ type: 'NONE', isConnected: false, isInternetReachable: false })
	h.requestLxAutoSync()
	await flush()
	assert.equal(h.syncCalls.length, 0)
})

await check('automatic sync uses merge mode and coalesces simultaneous triggers', async () => {
	const pending = deferred()
	const h = fixture({ syncResult: () => pending.promise })
	configure(h)
	h.requestLxAutoSync()
	h.requestLxAutoSync()
	await flush()
	assert.equal(h.syncCalls.length, 1)
	assert.equal(h.syncCalls[0].mode, 'merge_local_remote')
	pending.resolve({ serverName: 'LX' })
	await flush()
	assert.equal(h.disk.has('sync.lastAutoError'), false)
})

await check('Wi-Fi-only mode accepts Wi-Fi and Ethernet but skips cellular', async () => {
	const h = fixture()
	configure(h)
	h.persist.set('sync.autoWifiOnly', true)
	h.setNetwork({ type: 'CELLULAR', isConnected: true, isInternetReachable: true })
	h.requestLxAutoSync()
	await flush()
	assert.equal(h.syncCalls.length, 0)
	h.setNetwork({ type: 'ETHERNET', isConnected: true, isInternetReachable: true })
	h.requestLxAutoSync()
	await flush()
	assert.equal(h.syncCalls.length, 1)
})

await check('failures record an error and retry with exponential delays', async () => {
	const h = fixture({ syncResult: async () => { throw new Error('offline') } })
	configure(h)
	h.requestLxAutoSync()
	await flush()
	assert.equal(h.syncCalls.length, 1)
	assert.equal(h.persist.get('sync.lastAutoError'), 'offline')
	assert.equal([...h.timers.values()][0].delay, 15_000)
	h.runNextTimer()
	await flush()
	assert.equal(h.syncCalls.length, 2)
	assert.equal([...h.timers.values()][0].delay, 30_000)
	h.persist.set('sync.autoEnabled', false)
	h.runNextTimer()
	await flush()
	assert.equal(h.syncCalls.length, 2)
})

await check('credential and network preflight failures are contained and retried', async () => {
	const h = fixture()
	configure(h)
	h.setCredentialsError(new Error('secure storage unavailable'))
	h.requestLxAutoSync()
	await flush()
	assert.equal(h.syncCalls.length, 0)
	assert.equal(h.persist.get('sync.lastAutoError'), 'secure storage unavailable')
	assert.equal([...h.timers.values()][0].delay, 15_000)
})

await check('foreground and network recovery trigger sync while recent success suppresses duplicates', async () => {
	const h = fixture()
	configure(h)
	h.startLxAutoSync()
	h.emitAppState('background')
	h.emitAppState('active')
	await flush()
	assert.equal(h.syncCalls.length, 1)
	h.persist.set('sync.lastSuccessAt', Date.now())
	h.emitNetwork({ type: 'WIFI', isConnected: true, isInternetReachable: true })
	await flush()
	assert.equal(h.syncCalls.length, 1)
})

finish()
