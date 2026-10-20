import fs from 'node:fs'
import { createStore } from 'zustand'
import { createFixture, item, write, pathFromUri } from './file-system-fixture.mjs'
import { assert, checks, loadModule, deferred, flush, root } from './native-services-fixture.mjs'

const { check, finish } = checks()
const groups = loadModule('src/helpers/favoriteGroups.ts', {})
const snapshots = loadModule('src/helpers/librarySnapshots.ts', {})
const edits = loadModule('src/helpers/libraryEdits.ts', {})
const request = loadModule('src/helpers/requestControl.ts', {}, { Error, AbortController })
const song = (id, platform = 'tx', extra = {}) => ({
	id,
	platform,
	title: 'Song',
	artist: 'Singer',
	duration: 180,
	album: 'Album',
	url: 'Unknown',
	...extra,
})
const state = (value) => ({
	getValue: () => value,
	setValue: (next) => {
		value = next
	},
	useValue: () => value,
})
function maintenanceFixture() {
	const disk = new Map(),
		writes = []
	let failure
	const store = {
		getString: (key) => disk.get(key),
		remove: (key) => disk.delete(key),
		set: (key, value) => {
			if (key === failure || (typeof failure === 'function' && failure(key))) {
				failure = null
				throw new Error('disk full')
			}
			writes.push({ key, value })
			disk.set(key, value)
		},
		addOnValueChangedListener: () => ({ remove() {} }),
	}
	const persist = loadModule('src/store/PersistStatus.ts', {
		'@/store/getOrCreateMMKV': () => store,
		'@/utils/safeParse': (raw) => JSON.parse(raw),
		'./libraryStorage': loadModule('src/store/libraryStorage.ts', {}),
		react: {},
	}).default
	const library = { favorites: [] }
	const replaceFavorites = (tracks) => {
		persist.set('music.favorites', tracks)
		library.favorites = tracks
	}
	const lists = state([]),
		recent = state([])
	const modules = {
		'@/store/PersistStatus': persist,
		'@/store/library': { replaceFavorites, useLibraryStore: { getState: () => library } },
		'@/player/PlayerStore': { playListsStore: lists, recentlyPlayedStore: recent },
		'./libraryEdits': edits,
		'./librarySnapshots': snapshots,
	}
	return {
		...loadModule('src/helpers/libraryMaintenance.ts', modules),
		...loadModule('src/helpers/favoriteGroupActions.ts', {
			...modules,
			'./favoriteGroups': groups,
		}),
		persist,
		disk,
		writes,
		library,
		lists,
		replaceFavorites,
		fail: (key) => {
			failure = key
		},
	}
}
await check(
	'storage-boundary snapshots cover favorites and playlist refresh, retain history and roll back failed writes',
	() => {
		const h = maintenanceFixture(),
			first = song('a'),
			second = song('b', 'wy')
		h.replaceFavorites([first])
		h.replaceFavorites([second])
		let history = h.persist.get('library.snapshots')
		assert.equal(history.length, 1)
		assert.equal(history[0].songs[0].id, first.id)
		const oldHistory = JSON.stringify(history)
		h.fail('music.favorites')
		assert.throws(() => h.replaceFavorites([song('new')]), /disk full/)
		assert.equal(h.library.favorites[0].id, second.id)
		assert.equal(JSON.stringify(h.persist.get('library.snapshots')), oldHistory)
		h.fail('library.snapshots')
		assert.throws(() => h.replaceFavorites([]), /disk full/)
		assert.equal(h.persist.get('music.favorites')[0].id, second.id)
		const list = {
			id: 'playlist',
			name: 'My playlist',
			songs: [first, second],
			sourceOverrides: { old: 'tx@a' },
		}
		h.persist.set('music.playLists', [list])
		h.persist.set('music.playLists', [{ ...list, songs: [second] }])
		history = h.persist.get('library.snapshots')
		assert.equal(history[0].playlist.sourceOverrides.old, 'tx@a')
		assert.equal(history[0].songs.length, 2)
		for (let index = 0; index < 25; index++) h.replaceFavorites([song(String(index))])
		assert.equal(h.persist.get('library.snapshots').length, 20)
		assert.equal(
			snapshots.retainedSnapshots([{ ...history[0], createdAt: Date.now() - 31 * 86400_000 }])
				.length,
			0,
		)
	},
)
await check(
	'chunked library migration preserves legacy history, playlist metadata and restart reads',
	() => {
		const h = maintenanceFixture()
		const list = {
			id: 'legacy',
			name: 'Old',
			songs: [song('old')],
			sourceOverrides: { old: 'wy@new' },
		}
		const oldHistory = [
			{
				id: 'old-history',
				createdAt: Date.now(),
				target: 'legacy',
				title: 'Old',
				songs: list.songs,
				playlist: list,
			},
		]
		h.disk.set('music.playLists', JSON.stringify([list]))
		h.disk.set('library.snapshots', JSON.stringify(oldHistory))
		h.persist.set('music.playLists', [{ ...list, songs: [song('new')] }])
		assert.equal(h.persist.get('music.playLists')[0].songs[0].id, 'new')
		const history = h.persist.get('library.snapshots')
		assert.equal(history.length, 2)
		assert.equal(history[0].playlist.sourceOverrides.old, 'wy@new')
		assert.equal(history[1].id, 'old-history')
		assert.equal(history[1].songs[0].id, 'old')
		const storage = loadModule('src/store/libraryStorage.ts', {})
		const restarted = storage.readLibraryStorage(
			{ getString: (key) => h.disk.get(key) },
			'music.playLists',
		)
		assert.equal(restarted[0].songs[0].id, 'new')
		assert.equal(restarted[0].sourceOverrides.old, 'wy@new')
		h.disk.set('music.favorites', JSON.stringify([song('legacy-favorite')]))
		h.persist.set('music.favorites', [song('replacement')])
		assert.equal(h.persist.get('library.snapshots')[0].songs[0].id, 'legacy-favorite')
	},
)
await check(
	'unchanged chunks and other playlists are reused; edits write bounded data and no-ops write nothing',
	() => {
		const h = maintenanceFixture()
		const tracks = Array.from({ length: 10_000 }, (_, i) => song(String(i)))
		h.persist.set('music.favorites', tracks)
		const initial = [...h.disk.keys()].filter((key) => key.startsWith('library.chunk.'))
		h.writes.length = 0
		h.persist.set('music.favorites', tracks)
		assert.equal(h.writes.length, 0)
		for (let i = 0; i < 8; i++) {
			tracks[0] = { ...tracks[0], title: 'Edit ' + i }
			h.persist.set('music.favorites', tracks)
		}
		const chunks = [...h.disk.keys()].filter((key) => key.startsWith('library.chunk.'))
		assert.equal(chunks.length, initial.length + 8)
		assert.equal(h.persist.get('library.snapshots').length, 8)
		assert.equal(h.persist.get('library.snapshots').at(-1).songs[0].title, 'Song')
		assert.ok(h.writes.reduce((total, entry) => total + entry.value.length, 0) < 500_000)
		const lists = [
			{ id: 'one', name: 'One', songs: tracks },
			{ id: 'two', name: 'Two', songs: [song('second')] },
		]
		h.persist.set('music.playLists', lists)
		const manifestBefore = JSON.parse(h.disk.get('music.playLists'))
		h.writes.length = 0
		h.persist.set('music.playLists', [{ ...lists[0], name: 'Renamed' }, lists[1]])
		assert.equal(h.writes.filter((entry) => entry.key.startsWith('library.chunk.')).length, 0)
		assert.equal(
			JSON.stringify(JSON.parse(h.disk.get('music.playLists')).entries[1]),
			JSON.stringify(manifestBefore.entries[1]),
		)
		assert.equal(h.persist.get('library.snapshots')[0].title, 'One')
	},
)
await check(
	'chunk, history and collection failures preserve all live data; retention removes only unreferenced chunks',
	() => {
		const h = maintenanceFixture()
		h.persist.set('music.favorites', [song('keep')])
		for (const failure of [
			(key) => key.startsWith('library.chunk.'),
			'library.snapshots',
			'music.favorites',
		]) {
			const before = JSON.stringify([...h.disk])
			h.fail(failure)
			assert.throws(() => h.persist.set('music.favorites', [song('failed')]), /disk full/)
			assert.equal(JSON.stringify([...h.disk]), before)
			assert.equal(h.persist.get('music.favorites')[0].id, 'keep')
		}
		for (let i = 0; i < 30; i++) h.persist.set('music.favorites', [song(String(i))])
		assert.equal(h.persist.get('library.snapshots').length, 20)
		assert.equal([...h.disk.keys()].filter((key) => key.startsWith('library.chunk.')).length, 21)
		h.persist.set('library.snapshots', [])
		assert.equal([...h.disk.keys()].filter((key) => key.startsWith('library.chunk.')).length, 1)
		assert.equal(h.persist.get('music.favorites')[0].id, '29')
		h.persist.set('music.favorites', undefined)
		assert.equal(h.persist.get('music.favorites'), null)
		assert.equal(h.persist.get('library.snapshots')[0].songs[0].id, '29')
	},
)
await check(
	'interrupted chunk cleanup preserves published data and removes orphaned writes',
	() => {
		const h = maintenanceFixture()
		h.persist.set('music.favorites', [song('published')])
		const active = [...h.disk.keys()].find((key) => key.startsWith('library.chunk.'))
		const orphan = 'library.chunk.interrupted-orphan'
		h.disk.set(orphan, JSON.stringify([song('unpublished')]))
		h.disk.set('library.pendingChunks', JSON.stringify([active, orphan]))
		h.persist.set('music.favorites', [song('published')])
		assert.equal(h.disk.has(orphan), false)
		assert.equal(h.disk.has(active), true)
		assert.equal(h.disk.has('library.pendingChunks'), false)
		assert.equal(h.persist.get('music.favorites')[0].id, 'published')
	},
)
await check(
	'history size limits prune unique chunks while retaining the latest complete recovery point',
	() => {
		const h = maintenanceFixture(),
			padding = 'x'.repeat(1_100_000)
		for (let i = 0; i < 10; i++)
			h.persist.set('music.favorites', [song(String(i), 'tx', { padding })])
		const history = h.persist.get('library.snapshots')
		assert.ok(history.length < 9)
		assert.equal(history[0].songs[0].id, '8')
		assert.equal(history[0].songs[0].padding, padding)
		assert.equal(
			[...h.disk.keys()].filter((key) => key.startsWith('library.chunk.')).length,
			history.length + 1,
		)
		assert.equal(h.persist.get('music.favorites')[0].id, '9')
	},
)
await check(
	'snapshot previews detect changes; recovery preserves other playlists and creates a redo point',
	() => {
		const h = maintenanceFixture(),
			first = song('a'),
			second = song('b', 'wy')
		h.replaceFavorites([first, second])
		h.replaceFavorites([second])
		let snapshot = h.persist.get('library.snapshots')[0]
		const initial = h.snapshotTargetFingerprint(snapshot)
		h.replaceFavorites([second, song('new')])
		assert.equal(h.restoreLibrarySnapshot(snapshot.id, initial), false)
		assert.equal(h.restoreLibrarySnapshot(snapshot.id, h.snapshotTargetFingerprint(snapshot)), true)
		assert.equal(h.library.favorites.length, 2)
		assert.equal(
			h.persist.get('library.snapshots')[0].songs.some((track) => track.id === 'new'),
			true,
		)
		const list = { id: 'one', title: 'First', songs: [first, second] },
			other = { id: 'two', title: 'Other', songs: [song('other')] }
		h.lists.setValue([list, other])
		h.persist.set('music.playLists', [list, other])
		h.persist.set('music.playLists', [other])
		h.lists.setValue([other])
		snapshot = h.persist.get('library.snapshots')[0]
		assert.equal(snapshot.target, 'one')
		assert.equal(h.restoreLibrarySnapshot(snapshot.id, 'missing'), true)
		assert.equal(
			h.lists.getValue().find((item) => item.id === 'two'),
			other,
		)
		assert.equal(h.lists.getValue().find((item) => item.id === 'one').songs.length, 2)
		const diff = snapshots.compareSnapshotSongs(
			[first, { ...second, title: 'Changed' }],
			[second, song('new')],
		)
		assert.equal(diff.added, 1)
		assert.equal(diff.removed, 1)
		assert.equal(diff.changed, 1)
		assert.equal(diff.reordered, true)
	},
)
await check(
	'confirmed repair rechecks latest entries and skips deletion, metadata edits and duplicate destinations',
	() => {
		const h = maintenanceFixture(),
			a = song('a'),
			b = song('b'),
			c = song('c'),
			dest = song('replacement', 'wy')
		h.replaceFavorites([a, { ...b, title: 'Edited' }, song('added')])
		assert.equal(
			h.applyLibraryRepair(
				'favorites',
				[a, b, c],
				[a, b, c].map((original) => ({ original, replacement: dest })),
			),
			1,
		)
		assert.equal(h.library.favorites.length, 3)
		assert.equal(h.library.favorites[1].title, 'Edited')
		const list = { id: 'list', name: 'List', songs: [a, b], sourceSnapshotKeys: ['tx@a', 'tx@b'] }
		h.lists.setValue([list])
		h.persist.set('music.playLists', [list])
		assert.equal(h.applyLibraryRepair('list', [a, b], [{ original: a, replacement: dest }]), 1)
		assert.equal(h.lists.getValue()[0].sourceOverrides['tx@a'], 'wy@replacement')
		h.lists.setValue([])
		assert.throws(
			() => h.applyLibraryRepair('list', [a], [{ original: a, replacement: dest }]),
			/no longer exists/,
		)
	},
)
await check(
	'platform management removes one version, changes the default and retains the final version on failure',
	() => {
		const h = maintenanceFixture(),
			a = song('a'),
			b = song('b', 'wy'),
			c = song('c', 'kg')
		h.replaceFavorites([groups.mergeFavoriteGroup([a, b, c])])
		h.preferFavoriteSource(a, b)
		assert.equal(h.library.favorites[0].platform, 'wy')
		h.fail('music.favorites')
		assert.throws(() => h.removeFavoriteVariant(a, b), /disk full/)
		assert.equal(h.library.favorites[0].platform, 'wy')
		assert.equal(h.removeFavoriteVariant(a, b), true)
		assert.equal(groups.isFavoriteTrack(h.library.favorites[0], b), false)
		assert.equal(h.removeFavoriteVariant(a, c), true)
		assert.equal(h.removeFavoriteVariant(a, a), false)
		assert.equal(h.library.favorites.length, 1)
	},
)
await check(
	'repair planner tolerates probe errors, rejects incompatible recordings and cancels without applying',
	async () => {
		const calls = [],
			progress = []
		const repair = loadModule('src/helpers/libraryRepair.ts', {
			'@/constants/images': { fakeAudioMp3Uri: 'fake' },
			'@/helpers/crossPlatformSearch': {
				searchSongsAcrossPlatforms: async (query) => ({
					data: [
						song(query.includes('Second') ? 'second-replacement' : 'replacement', 'wy', {
							title: query.includes('Second') ? 'Second' : 'Song',
						}),
						song('live', 'kg', { title: 'Song Live' }),
					],
				}),
			},
			'@/helpers/playlistOrganizer': {
				rankReplacementSourcesWithScore: (_, tracks) =>
					tracks.map((track) => ({ track, score: 20 })),
			},
			'@/player/MusicSourceResolver': {
				resolveSource: async (track) => {
					calls.push(track.id)
					if (track.platform === 'tx') throw new Error('network')
					return { url: 'https://audio.test/song.mp3' }
				},
			},
			'./favoriteGroups': groups,
			'./requestControl': request,
		})
		const original = [song('old'), song('second', 'tx', { title: 'Second' })],
			frozen = JSON.stringify(original)
		const plan = await repair.repairUnavailableTracks(original, {
			onProgress: (n) => progress.push(n),
		})
		assert.equal(plan.unavailable, 2)
		assert.equal(plan.repaired, 2)
		assert.equal(JSON.stringify(original), frozen)
		assert.equal(groups.getFavoriteVariants(plan.replacements[0].replacement).length, 2)
		assert.equal(progress.join(','), '1,2')
		assert.equal(calls.includes('live'), false)
		const abort = new AbortController()
		abort.abort()
		await assert.rejects(repair.repairUnavailableTracks(original, { signal: abort.signal }), {
			name: 'AbortError',
		})
	},
)
await check(
	'calendar reports cover leap months, previous years, streaks, bounded charts and 400-day retention',
	() => {
		const h = maintenanceFixture()
		const identity = loadModule('src/helpers/listeningIdentity.ts', { './favoriteGroups': groups })
		const reports = loadModule('src/helpers/listeningReport.ts', {
			'@/store/PersistStatus': h.persist,
			'./listeningIdentity': identity,
		})
		for (const day of [27, 28, 29])
			reports.recordListeningDay(song('a'), 60, 1, new Date(2024, 1, day, 12))
		const monthly = reports.buildListeningReport(
			h.persist.get('music.listeningDaily'),
			new Date(2024, 2, 10, 12),
			true,
			[],
			'month',
		)
		assert.equal(monthly.from, '2024-02-01')
		assert.equal(monthly.through, '2024-02-29')
		assert.equal(monthly.seconds, 180)
		assert.equal(monthly.activeDays, 3)
		assert.equal(monthly.longestStreak, 3)
		assert.equal(monthly.currentStreak, 3)
		const annual = reports.buildListeningReport(
			h.persist.get('music.listeningDaily'),
			new Date(2025, 9, 20, 12),
			true,
			[],
			'year',
		)
		assert.equal(annual.bars.length, 366)
		assert.equal(annual.through, '2024-12-31')
		assert.equal(reports.listeningChartBars(annual.bars).length, 12)
		assert.equal(
			reports.listeningChartBars(annual.bars).reduce((sum, item) => sum + item.seconds, 0),
			180,
		)
		for (let index = 0; index < 405; index++) {
			const day = new Date(2024, 0, 1, 12)
			day.setDate(day.getDate() + index)
			reports.recordListeningDay(song('a'), 1, 0, day)
		}
		assert.equal(h.persist.get('music.listeningDaily').length, 400)
	},
)

const fixture = createFixture()
function reactFixture() {
	let index = 0,
		refIndex = 0
	const states = [],
		refs = []
	const react = {
		createElement: (type, props, ...children) => ({
			type,
			props: { ...props, children: children.flat().filter(Boolean) },
		}),
		useMemo: (fn) => fn(),
		useEffect() {},
		useState: (initial) => {
			const slot = index++
			if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial
			return [
				states[slot],
				(next) => {
					states[slot] = typeof next === 'function' ? next(states[slot]) : next
				},
			]
		},
		useRef: (initial) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }),
	}
	return {
		react,
		render: (Screen) => {
			index = 0
			refIndex = 0
			return Screen()
		},
	}
}
const find = (node, type, title) => {
	if (!node || typeof node !== 'object') return undefined
	if (node.type === type && (!title || node.props.title === title)) return node
	for (const child of node.props?.children ?? []) {
		const result = find(child, type, title)
		if (result) return result
	}
}
await check(
	'the real repair screen waits for explicit review confirmation and ignores a cancelled late scan',
	async () => {
		const h = maintenanceFixture(),
			ui = reactFixture(),
			pending = [deferred(), deferred()],
			alerts = []
		let scan = 0
		const first = song('old'),
			replacement = groups.mergeFavoriteGroup([song('replacement', 'wy'), first])
		h.replaceFavorites([first])
		const Screen = loadModule(
			'src/app/(modals)/libraryRepair.tsx',
			{
				react: ui.react,
				'react-native': {
					FlatList: 'List',
					View: 'View',
					Text: 'Text',
					Pressable: 'Pressable',
					Alert: { alert: (...args) => alerts.push(args) },
				},
				'expo-router': { useLocalSearchParams: () => ({ target: 'favorites' }) },
				'@/components/LibraryToolButton': { LibraryToolButton: 'Button' },
				'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
				'@/helpers/libraryRepair': { repairUnavailableTracks: () => pending[scan++].promise },
				'@/helpers/libraryMaintenance': h,
				'@/helpers/libraryEdits': edits,
				'@/player/PlayerStore': {
					playListsStore: h.lists,
					musicApiSelectedStore: state({ id: 'source' }),
				},
				'@/store/library': { useFavorites: () => ({ favorites: h.library.favorites }) },
				'@/utils/i18n': { t: (key) => key },
			},
			{ React: ui.react },
		).default
		let screen = ui.render(Screen)
		find(screen.props.ListHeaderComponent, 'Button', 'maintenance.scan').props.onPress()
		pending[0].resolve({
			tracks: [replacement],
			unavailable: 1,
			repaired: 1,
			review: [],
			replacements: [{ original: first, replacement }],
		})
		await flush()
		screen = ui.render(Screen)
		assert.equal(h.library.favorites[0].id, first.id)
		assert.equal(screen.props.data.length, 1)
		find(screen.props.ListHeaderComponent, 'Button', 'maintenance.apply').props.onPress()
		assert.equal(h.library.favorites[0].id, first.id)
		alerts.at(-1)[2][1].onPress()
		assert.equal(h.library.favorites[0].id, 'replacement')
		screen = ui.render(Screen)
		find(screen.props.ListHeaderComponent, 'Button', 'maintenance.scan').props.onPress()
		screen = ui.render(Screen)
		find(screen.props.ListHeaderComponent, 'Button', 'find.cancel').props.onPress()
		pending[1].resolve({ tracks: [], unavailable: 1, repaired: 0, review: [], replacements: [] })
		await flush()
		screen = ui.render(Screen)
		assert.equal(screen.props.data.length, 0)
		assert.equal(h.library.favorites[0].id, 'replacement')
	},
)
await check('the diagnostics screen filters actual events and redacts copied summaries', () => {
	const h = maintenanceFixture(),
		ui = reactFixture(),
		copied = []
	h.persist.set('music.sourceDiagnostics', [
		{
			id: 'one',
			timestamp: 1,
			requestKey: 'request',
			requestType: 'current',
			track: song('one'),
			sourceName: 'Source A',
			result: 'failure',
			category: 'network',
			step: 'native',
			message: 'token=secret-value',
		},
		{
			id: 'two',
			timestamp: 2,
			requestKey: 'request2',
			requestType: 'current',
			track: song('two', 'wy', { title: 'Other' }),
			sourceName: 'Source B',
			result: 'success',
			step: 'resolve',
		},
	])
	const logger = loadModule('src/helpers/logger.ts', { zustand: { createStore, useStore() {} } })
	const diagnostics = loadModule('src/helpers/userApi/sourceDiagnostics.ts', {
		'@/utils/i18n': { t: (key) => key },
		'@/store/PersistStatus': h.persist,
	})
	const Screen = loadModule(
		'src/app/(modals)/sourceDiagnostics.tsx',
		{
			react: ui.react,
			'react-native': {
				Alert: { alert() {} },
				Clipboard: { setString: (text) => copied.push(text) },
				FlatList: 'List',
				Text: 'Text',
				TextInput: 'Input',
				View: 'View',
				Share: {},
			},
			'@/store/PersistStatus': { ...h.persist, useValue: (key) => h.persist.get(key) },
			'@/helpers/userApi/sourceDiagnostics': diagnostics,
			'@/helpers/logger': logger,
			'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
			'@/components/LibraryToolButton': { LibraryToolButton: 'Button' },
			'@/utils/i18n': { t: (key) => key },
		},
		{ React: ui.react },
	).default
	let screen = ui.render(Screen)
	assert.equal(screen.props.data.length, 1)
	find(screen.props.ListHeaderComponent, 'Button', 'diagnostics.copy').props.onPress()
	assert.equal(copied[0].includes('secret-value'), false)
	assert.equal(copied[0].includes('[tx]'), true)
	find(screen.props.ListHeaderComponent, 'Button', 'diagnostics.showAll').props.onPress()
	screen = ui.render(Screen)
	assert.equal(screen.props.data.length, 2)
	find(screen.props.ListHeaderComponent, 'Input').props.onChangeText('Source B')
	screen = ui.render(Screen)
	assert.equal(screen.props.data.length, 1)
	assert.equal(screen.props.data[0].id, 'two')
})
const settle = async (h) => {
	for (let index = 0; index < 400; index++) {
		if (
			!h.stores.cacheDownloadTasksStore
				.getValue()
				.some((task) => ['queued', 'downloading'].includes(task.status))
		)
			return
		await new Promise((resolve) => setTimeout(resolve, 5))
	}
	assert.fail('Downloads did not settle')
}
try {
	await check(
		'real downloads reuse equivalent platform files, serialize concurrent copies and allow quality upgrades or explicit copies',
		async () => {
			const h = fixture.runtime({
				realCache: true,
				moduleOverrides: {
					'@/player/MusicSourceResolver': {
						resolveSource: async (track, options) => ({
							url: `https://audio.test/${track.id}`,
							quality: options.quality,
						}),
					},
				},
			})
			h.hooks.download = async ({ fileUri, url }) => {
				await write(pathFromUri(fileUri), url)
				return { uri: fileUri, status: 200, headers: {} }
			}
			const manager = h.load('src/player/DownloadManager.ts')
			const a = song('dedup-a'),
				b = song('dedup-b', 'wy')
			await Promise.all([
				manager.enqueueDownload(a, { quality: '320k', strictQuality: true }),
				manager.enqueueDownload(b, { quality: '320k', strictQuality: true }),
			])
			await settle(h)
			assert.equal(h.calls.downloads.length, 1)
			assert.equal(h.stores.importedLocalMusicStore.getValue().length, 1)
			assert.equal(
				h.stores.importedLocalMusicStore.getValue()[0].platform,
				'tx',
				'Keep the actual file owner metadata',
			)
			await manager.enqueueDownload(b, { quality: 'flac', strictQuality: true })
			await settle(h)
			assert.equal(h.calls.downloads.length, 2, 'A quality upgrade is not silently skipped')
			h.persistence.set('music.allowDuplicateDownloads', true)
			await manager.enqueueDownload(b, { quality: '320k', strictQuality: true })
			await settle(h)
			assert.equal(h.calls.downloads.length, 3)
			assert.equal(h.stores.importedLocalMusicStore.getValue().length, 3)
		},
	)
	await check(
		'download matching keeps live versions, local tracks and explicit favorite splits separate',
		() => {
			const dedup = loadModule('src/helpers/downloadDedup.ts', { './favoriteGroups': groups })
			const a = song('a'),
				b = song('b', 'wy')
			assert.equal(dedup.sameDownloadRecording(a, b, []), true)
			assert.equal(dedup.sameDownloadRecording(a, { ...b, title: 'Song Live' }, []), false)
			assert.equal(dedup.sameDownloadRecording(a, { ...b, platform: 'local' }, []), false)
			assert.equal(
				dedup.sameDownloadRecording(a, b, [
					{ ...a, favoriteKeepSeparate: true },
					{ ...b, favoriteKeepSeparate: true },
				]),
				false,
			)
			assert.equal(dedup.reusableDownloadQuality('flac', '320k', true), false)
			assert.equal(dedup.reusableDownloadQuality('flac', '320k', false), true)
		},
	)
	await check(
		'the actual native report-card bridge forwards data to PNG rendering and sharing',
		async () => {
			const calls = []
			const bridge = loadModule('modules/cymusic-native/sharing.ts', {
				expo: {
					requireOptionalNativeModule: () => ({
						renderReportCard: async (...args) => {
							calls.push(args)
							return 'file:///report.png'
						},
						shareFiles: async (paths) => {
							calls.push(paths)
							return true
						},
					}),
				},
			})
			const path = await bridge.renderReportCard('Report', ['60 minutes', 'Top song'])
			await bridge.shareLocalFiles([path])
			assert.equal(calls[0][0], 'Report')
			assert.equal(calls[1][0], 'file:///report.png')
			const swift = fs.readFileSync(
				`${root}/modules/cymusic-native/ios/CyMusicFileSharingModule.swift`,
				'utf8',
			)
			assert.match(swift, /UIGraphicsImageRenderer/)
			assert.match(swift, /image\.pngData\(\)/)
			assert.match(swift, /lines\.prefix\(10\)/)
		},
	)
} finally {
	await fixture.dispose()
}
finish()
