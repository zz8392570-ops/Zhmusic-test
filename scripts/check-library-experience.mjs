import fs from 'node:fs'
import path from 'node:path'
import { assert, checks, deferred, flush, loadModule, root } from './native-services-fixture.mjs'
const { check, finish } = checks()
const edits = loadModule('src/helpers/libraryEdits.ts', {})
const importing = loadModule('src/helpers/importPlaylist.ts', {
	'@/constants/images': { unknownTrackImageUri: 'fallback' },
	'@/components/utils/musicSdk/utils': { formatSingerName: (name) => name },
	'@/helpers/libraryEdits': edits,
})
const song = (id, platform = 'kw') => ({
	id,
	platform,
	title: id,
	artist: 'Artist',
	album: '',
	url: 'Unknown',
})
const playlist = (songs) => ({
	id: 'kw__123',
	sourcePlaylistId: '123',
	sourceSnapshotKeys: songs.map(edits.getLibraryTrackKey),
	platform: 'kw',
	name: 'My list',
	title: 'My list',
	artist: '',
	artwork: '',
	songs,
})
function persistence() {
	const values = new Map(),
		listeners = new Set()
	let failure
	return {
		get: (key) => (values.has(key) ? JSON.parse(values.get(key)) : null),
		set(key, value) {
			if (failure === key) {
				failure = undefined
				throw new Error('storage failed')
			}
			values.set(key, JSON.stringify(value))
			for (const callback of listeners) callback(key)
		},
		subscribe(callback) {
			listeners.add(callback)
			return () => listeners.delete(callback)
		},
		failOnce(key) {
			failure = key
		},
	}
}
const recycleFixture = () => {
	const store = persistence()
	return {
		store,
		...loadModule('src/helpers/libraryRecycle.ts', {
			'@/store/PersistStatus': store,
			'./libraryEdits': edits,
		}),
	}
}
await check('removed songs restore without duplicating or overwriting subsequent additions', () => {
	const h = recycleFixture(),
		list = playlist([song('a'), song('b')])
	h.persistPlaylistsWithRecovery([list], [{ ...list, songs: [song('a')] }])
	const entry = h.getRecycleEntries()[0]
	assert.equal(entry.kind, 'songs')
	assert.equal(entry.playlist.songs[0].id, 'b')
	const current = [{ ...list, name: 'Renamed', songs: [song('a'), song('new')] }]
	const next = h.restoreRecycleEntry(entry.id, current)
	assert.equal(next[0].name, 'Renamed')
	assert.equal(next[0].songs.map((item) => item.id).join(','), 'a,new,b')
	assert.equal(h.getRecycleEntries().length, 0)
})
await check(
	'deleted playlists recover, retention expires old entries and failed writes roll back',
	() => {
		const h = recycleFixture(),
			list = playlist([song('a')])
		h.store.set('music.playLists', [list])
		h.store.failOnce('music.playLists')
		assert.throws(() => h.persistPlaylistsWithRecovery([list], []), /storage/)
		assert.equal(h.getRecycleEntries().length, 0)
		assert.equal(h.store.get('music.playLists').length, 1)
		h.persistPlaylistsWithRecovery([list], [])
		const entry = h.getRecycleEntries()[0]
		assert.equal(entry.kind, 'playlist')
		h.store.failOnce('library.recycleBin')
		assert.throws(() => h.restoreRecycleEntry(entry.id, []), /storage/)
		assert.equal(h.store.get('music.playLists').length, 0)
		assert.equal(h.getRecycleEntries().length, 1)
		assert.equal(h.restoreRecycleEntry(entry.id, []).length, 1)
		h.store.set('library.recycleBin', [{ ...entry, deletedAt: Date.now() - 31 * 86400_000 }])
		assert.equal(h.getRecycleEntries().length, 0)
	},
)
await check('reports separate two seven-day periods, platforms and real listening duration', () => {
	const store = persistence(),
		api = loadModule('src/helpers/listeningReport.ts', { '@/store/PersistStatus': store })
	api.recordListeningDay(song('same'), 120, 1, new Date(2026, 9, 19, 12))
	api.recordListeningDay(song('same', 'tx'), 60, 2, new Date(2026, 9, 18, 12))
	api.recordListeningDay(song('old'), 900, 5, new Date(2026, 9, 12, 12))
	const days = store.get('music.listeningDaily'),
		now = new Date(2026, 9, 19, 12)
	const current = api.buildListeningReport(days, now)
	assert.equal(current.seconds, 180)
	assert.equal(current.plays, 3)
	assert.equal(current.songCount, 2)
	assert.equal(current.bars.length, 7)
	assert.equal(current.bars[0].date, '2026-10-13')
	assert.equal(api.buildListeningReport(days, now, true).seconds, 900)
	assert.equal(store.get('music.listeningDailySince'), new Date(2026, 9, 19, 12).getTime())
})
function refreshFixture(initial, remote) {
	const store = persistence()
	store.set('library.autoRefresh', 1)
	let lists = [initial],
		appState = 'active',
		network = { type: 'wifi', isConnected: true },
		fetches = 0
	const timers = new Map()
	let timerId = 0
	const api = loadModule(
		'src/helpers/playlistAutoRefresh.ts',
		{
			'@/store/PersistStatus': store,
			'@/helpers/trackPlayerIndex': {
				playListsStore: { getValue: () => lists },
				default: {
					updateStoredPlaylist(id, patch) {
						const current = lists.find((item) => item.id === id)
						if (!current) return 'not-found'
						const next = patch(current)
						if (!next) return 'conflict'
						lists = lists.map((item) => (item.id === id ? { ...item, ...next } : item))
						return 'success'
					},
				},
				__esModule: true,
			},
			'./importPlaylist': {
				...importing,
				fetchImportedPlaylistSongs: async () => {
					fetches++
					return typeof remote === 'function' ? remote() : remote
				},
			},
			'./libraryEdits': edits,
			'react-native': {
				AppState: {
					get currentState() {
						return appState
					},
					addEventListener() {
						return { remove() {} }
					},
				},
			},
			'expo-network': {
				NetworkStateType: { WIFI: 'wifi', ETHERNET: 'ethernet' },
				getNetworkStateAsync: async () => network,
				addNetworkStateListener() {
					return { remove() {} }
				},
			},
		},
		{
			setTimeout(callback) {
				const id = ++timerId
				timers.set(id, callback)
				return id
			},
			clearTimeout: (id) => timers.delete(id),
		},
	)
	return {
		...api,
		store,
		timers,
		get lists() {
			return lists
		},
		set lists(value) {
			lists = value
		},
		get fetches() {
			return fetches
		},
		setState(value) {
			appState = value
		},
		setNetwork(value) {
			network = value
		},
	}
}
await check(
	'automatic refresh preserves local order, additions and removals, then respects its interval',
	async () => {
		const a = song('a'),
			b = song('b'),
			removed = song('removed'),
			local = song('local'),
			added = song('remote-new')
		const base = {
			...playlist([b, a, local]),
			sourceSnapshotKeys: [a, b, removed].map(edits.getLibraryTrackKey),
		}
		const h = refreshFixture(base, { songs: [a, b, removed, added], sourcePlaylistId: '123' })
		await h.runPlaylistAutoRefresh()
		assert.equal(h.lists[0].songs.map((item) => item.id).join(','), 'b,a,local,remote-new')
		assert.equal(h.store.get('library.refreshStatus')[base.id].added, 1)
		assert.equal(h.timers.size, 0)
		await h.runPlaylistAutoRefresh()
		assert.equal(h.fetches, 1)
	},
)
await check(
	'refresh cannot resurrect a removed playlist or overwrite edits made during its request',
	async () => {
		const wait = deferred(),
			base = playlist([song('a'), song('b')])
		const h = refreshFixture(base, () => wait.promise)
		const work = h.runPlaylistAutoRefresh()
		await flush()
		h.lists = [{ ...base, songs: [song('b')] }]
		wait.resolve({ songs: [song('a'), song('b'), song('new')], sourcePlaylistId: '123' })
		await work
		assert.equal(h.lists[0].songs.map((item) => item.id).join(','), 'b,new')
		const wait2 = deferred(),
			removed = refreshFixture(base, () => wait2.promise)
		const second = removed.runPlaylistAutoRefresh()
		await flush()
		removed.lists = []
		wait2.resolve({ songs: [song('a')], sourcePlaylistId: '123' })
		await second
		assert.equal(removed.lists.length, 0)
	},
)
await check(
	'refresh is opt-in and Wi-Fi-only; late timeout responses cannot change the library',
	async () => {
		const base = playlist([song('a')]),
			wait = deferred(),
			h = refreshFixture(base, () => wait.promise)
		h.store.set('library.autoRefresh', 0)
		await h.runPlaylistAutoRefresh()
		assert.equal(h.fetches, 0)
		h.store.set('library.autoRefresh', 1)
		h.setNetwork({ type: 'cellular' })
		await h.runPlaylistAutoRefresh()
		assert.equal(h.fetches, 0)
		h.setNetwork({ type: 'wifi' })
		const work = h.runPlaylistAutoRefresh()
		await flush()
		const callback = [...h.timers.values()][0]
		callback()
		await work
		assert.equal(h.store.get('library.refreshStatus')[base.id].error, true)
		wait.resolve({ songs: [song('late')], sourcePlaylistId: '123' })
		await flush()
		assert.equal(h.lists[0].songs[0].id, 'a')
		assert.equal(h.timers.size, 0)
	},
)
await check(
	'every modal has explicit navigation configuration and new route titles are localized',
	() => {
		const layout = fs.readFileSync(path.join(root, 'src/app/_layout.tsx'), 'utf8')
		for (const file of fs
			.readdirSync(path.join(root, 'src/app/(modals)'))
			.filter((file) => file.endsWith('.tsx'))) {
			assert(
				layout.includes(`(modals)/${file.slice(0, -4)}`),
				`Missing modal configuration: ${file}`,
			)
		}
		assert(layout.includes("['(modals)/releaseNotes', 'releaseNotes.title']"))
		for (const lang of ['zh', 'en']) {
			const labels = JSON.parse(
				fs.readFileSync(path.join(root, `src/locales/${lang}.json`), 'utf8'),
			)
			for (const section of [
				'recycleBin',
				'listeningReport',
				'playlistAutoRefresh',
				'releaseNotes',
			])
				assert.ok(labels[section].title)
		}
	},
)
finish()
