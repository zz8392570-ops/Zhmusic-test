import fs from 'node:fs/promises'
import { assert, checks, deferred, flush, loadModule } from './native-services-fixture.mjs'
import { createFixture, item, pathFromUri, write } from './file-system-fixture.mjs'
const { check, finish } = checks()
const fixture = createFixture()
const song = (id, extra = {}) =>
	item(id, 'Unknown', { platform: 'tx', title: id, artist: 'Singer', duration: 200, ...extra })
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
const until = async (predicate) => {
	for (let i = 0; i < 400; i++) {
		if (predicate()) return
		await tick()
	}
	throw Error('Operation did not settle')
}
function runtime() {
	let network = { type: 'cellular', isConnected: true }
	const networkListeners = new Set(),
		settingListeners = new Set(),
		requests = []
	const h = fixture.runtime({
		realCache: true,
		moduleOverrides: {
			'expo-network': {
				NetworkStateType: { WIFI: 'wifi', ETHERNET: 'ethernet' },
				getNetworkStateAsync: async () => network,
				addNetworkStateListener: (listener) => {
					networkListeners.add(listener)
					return { remove: () => networkListeners.delete(listener) }
				},
			},
			'@/player/MusicSourceResolver': {
				resolveSource: async (track, options) => {
					requests.push({ track, options })
					return { url: `https://audio.test/${track.id}`, quality: options.quality }
				},
			},
		},
	})
	const set = h.persistence.set
	h.persistence.set = (key, value) => {
		set(key, value)
		for (const listener of settingListeners) listener(key)
	}
	h.persistence.subscribe = (listener) => {
		settingListeners.add(listener)
		return () => settingListeners.delete(listener)
	}
	h.hooks.download = async ({ url, fileUri }) => {
		await write(pathFromUri(fileUri), url)
		return { uri: fileUri, status: 200, headers: {} }
	}
	const cache = h.load('src/player/CacheManager.ts'),
		manager = h.load('src/player/DownloadManager.ts')
	const saving = h.load('src/helpers/favoriteOffline.ts')
	return {
		...h,
		cache,
		manager,
		...saving,
		requests,
		setNetwork: (type) => {
			network = { type, isConnected: true }
			for (const listener of networkListeners) listener(network)
		},
		tasks: () => h.stores.cacheDownloadTasksStore.getValue(),
	}
}
try {
	await check(
		'new favorite saves stay off by default, skip local songs, and retain verified cached audio on cellular',
		async () => {
			const h = runtime(),
				track = song('retention')
			h.persistence.set('music.favorites', [track])
			await h.saveNewFavoriteOffline(track)
			assert.equal(h.tasks().length, 0)
			h.persistence.set('music.favoriteAutoSave', true)
			const cached = await h.cache.downloadToCache(
				{ ...track, url: 'https://audio.test/cache' },
				'128k',
			)
			h.stores.importedLocalMusicStore.setValue([{ ...track, url: cached, cacheKind: 'automatic' }])
			const downloads = h.calls.downloads.length
			await h.saveNewFavoriteOffline(track)
			assert.equal(h.calls.downloads.length, downloads)
			assert.equal(h.stores.importedLocalMusicStore.getValue()[0].cacheKind, 'saved')
			assert.equal(h.persistence.get('music.importedLocalMusic')[0].cacheKind, 'saved')
			assert.equal(h.requests.length, 0)
			assert.equal(h.tasks().length, 0)
			assert.equal(Object.keys(h.persistence.get('music.savedOffline')).length, 1)
			assert.equal(
				await fs.readFile(pathFromUri(h.cache.getCacheFileUri(cached)), 'utf8'),
				'https://audio.test/cache',
			)
			await h.saveNewFavoriteOffline(song('local', { platform: 'local' }))
			assert.equal(h.tasks().length, 0)
		},
	)
	await check(
		'favorite downloads wait for Wi-Fi independently of manual settings, restore their policy, and save exact chosen quality',
		async () => {
			const h = runtime(),
				track = song('wifi')
			h.persistence.set('music.favoriteAutoSave', true)
			h.persistence.set('music.favoriteOfflineQuality', 'flac')
			h.persistence.set('music.downloadWifiOnly', false)
			h.persistence.set('music.favorites', [track])
			const stop = h.manager.startDownloadNetworkPolicy()
			await Promise.all([h.saveNewFavoriteOffline(track), h.saveNewFavoriteOffline(track)])
			await until(() => h.tasks()[0]?.status === 'waiting-network')
			assert.equal(h.requests.length, 0)
			assert.equal(h.tasks().length, 1)
			assert.equal(h.tasks()[0].favoriteAutoSave, true)
			h.manager.restoreDownloadTasks()
			assert.equal(h.tasks()[0].favoriteAutoSave, true)
			h.setNetwork('wifi')
			await until(() => h.tasks()[0]?.status === 'completed')
			assert.equal(h.requests.length, 1)
			assert.equal(h.requests[0].options.quality, 'flac')
			assert.equal(h.requests[0].options.strictQuality, true)
			assert.ok(Object.keys(h.persistence.get('music.savedOffline')).length)
			stop()
		},
	)
	await check(
		'disabling favorite saving cancels waiting tasks; an existing manual pause is never restarted',
		async () => {
			const h = runtime(),
				track = song('cancel-wait')
			h.persistence.set('music.favoriteAutoSave', true)
			h.persistence.set('music.favorites', [track])
			const stop = h.manager.startDownloadNetworkPolicy()
			await h.saveNewFavoriteOffline(track)
			await until(() => h.tasks()[0]?.status === 'waiting-network')
			h.persistence.set('music.favoriteAutoSave', false)
			await until(() => h.tasks()[0]?.status === 'cancelled')
			h.setNetwork('wifi')
			await flush()
			assert.equal(h.requests.length, 0)
			h.persistence.set('music.favoriteAutoSave', true)
			h.stores.cacheDownloadTasksStore.setValue([
				{ ...h.tasks()[0], status: 'paused', favoriteAutoSave: false },
			])
			await h.saveNewFavoriteOffline(track)
			assert.equal(h.tasks()[0].status, 'paused')
			assert.equal(h.tasks()[0].favoriteAutoSave, false)
			stop()
		},
	)
	await check(
		'a network transition aborts a favorite resolution and cannot start its late cellular transfer',
		async () => {
			const h = runtime(),
				track = song('wifi-race')
			h.persistence.set('music.favoriteAutoSave', true)
			h.persistence.set('music.favorites', [track])
			// Hold native download startup via a deferred source seam in a fresh owner.
			const gate = deferred()
			let state = { type: 'wifi' },
				listener,
				sourceStarted = false
			const r = fixture.runtime({
				realCache: true,
				moduleOverrides: {
					'expo-network': {
						NetworkStateType: { WIFI: 'wifi' },
						getNetworkStateAsync: async () => state,
						addNetworkStateListener: (cb) => {
							listener = cb
							return { remove() {} }
						},
					},
					'@/player/MusicSourceResolver': {
						resolveSource: async () => {
							sourceStarted = true
							return gate.promise
						},
					},
				},
			})
			r.persistence.subscribe = () => () => {}
			r.persistence.set('music.favoriteAutoSave', true)
			const manager = r.load('src/player/DownloadManager.ts')
			const stop = manager.startDownloadNetworkPolicy()
			await manager.enqueueDownload(track, {
				favoriteAutoSave: true,
				strictQuality: true,
				quality: '320k',
			})
			await until(() => sourceStarted)
			state = { type: 'cellular' }
			listener(state)
			await until(
				() => r.stores.cacheDownloadTasksStore.getValue()[0]?.status === 'waiting-network',
			)
			gate.resolve({ url: 'https://audio.test/late', quality: '320k' })
			await flush()
			await tick()
			assert.equal(r.calls.downloads.length, 0)
			stop()
		},
	)
	await check(
		'favorite removed or switch disabled during file probing produces no save, including concurrent duplicate calls',
		async () => {
			const gate = deferred(),
				writes = [],
				toasts = [],
				track = song('late')
			const disk = new Map([
				['music.favoriteAutoSave', true],
				['music.favorites', [track]],
			])
			const helper = loadModule('src/helpers/favoriteOffline.ts', {
				'@/store/PersistStatus': { get: (key) => disk.get(key) },
				'@/player/PlayerStore': { importedLocalMusicStore: { getValue: () => [] } },
				'@/player/CacheManager': {
					getPlaybackCachedAudioInfo: () => gate.promise,
					markSavedOffline: (path) => writes.push(path),
				},
				'@/player/DownloadManager': {
					enqueueDownload: () => {
						throw Error('Unexpected download')
					},
				},
				'./favoriteGroups': loadModule('src/helpers/favoriteGroups.ts', {}),
				'@/utils/utils': { showToast: (...args) => toasts.push(args) },
				'@/utils/i18n': { t: (key) => key },
			})
			const first = helper.saveNewFavoriteOffline(track)
			await helper.saveNewFavoriteOffline(track)
			disk.set('music.favorites', [])
			gate.resolve({ localPath: '/owned/audio' })
			await first
			assert.equal(writes.length, 0)
			assert.equal(toasts.length, 0)
		},
	)
	await check(
		'playlist coverage verifies real files and compatible platform variants; missing and unsafe local files stay unavailable',
		async () => {
			const h = runtime(),
				a = song('cached'),
				b = song('alternate', { platform: 'kw', title: 'cached' })
			h.persistence.set('music.favorites', [{ ...a, sourceAlternatives: [b] }])
			const path = await h.cache.downloadToCache({ ...b, url: 'https://audio.test/b' }, '128k')
			const localPath = `${fixture.documents}/importedLocalMusic/owned.mp3`
			await write(localPath, 'audio')
			const list = [
				a,
				song('online'),
				song('local', { platform: 'local', url: localPath }),
				song('lost', {
					url: `${fixture.documents}/musicCache/missing.mp3`,
					originalId: 'provider-lost',
				}),
				song('unsafe', { platform: 'local', url: '/etc/passwd' }),
			]
			const helper = h.load('src/helpers/playlistOffline.ts')
			let rows = await helper.scanPlaylistOffline(list, new AbortController().signal)
			assert.deepEqual(
				rows.map((row) => row.state),
				['available', 'online', 'available', 'missing', 'unknown'],
			)
			const missing = helper.missingDownloadTracks(rows)
			assert.deepEqual(
				missing.map((t) => t.id),
				['online', 'provider-lost'],
			)
			assert.ok(missing.every((t) => t.url === 'Unknown'))
			await fs.unlink(pathFromUri(h.cache.getCacheFileUri(path)))
			rows = await helper.scanPlaylistOffline([a], new AbortController().signal)
			assert.equal(rows[0].state, 'online')
		},
	)
	await check(
		'playlist scan limits probes to four and abort retires pending work without reporting incomplete counts',
		async () => {
			const gate = deferred()
			let probes = 0
			const helper = loadModule('src/helpers/playlistOffline.ts', {
				'@/player/CacheManager': { getPlaybackCachedAudioInfo: async () => null },
				'./localFile': {
					resolveLocalFile: async () => {
						probes++
						await gate.promise
						return { status: 'nonlocal' }
					},
				},
			})
			const owner = new AbortController()
			const work = helper.scanPlaylistOffline(
				Array.from({ length: 100 }, (_, i) => song(String(i))),
				owner.signal,
			)
			await flush()
			assert.equal(probes, 4)
			owner.abort()
			gate.resolve()
			assert.equal(await work, null)
			assert.equal(probes, 4)
		},
	)
	await check(
		'start page routes apply only to a normal root launch and preserve deep links and share intents',
		() => {
			const helper = loadModule('src/helpers/startPage.ts', {})
			assert.equal(
				helper.getStartPageRoute('favorites', '/', false),
				'/(tabs)/favorites/favoriteMusic',
			)
			assert.equal(helper.getStartPageRoute('my', '/', false), '/(tabs)/favorites')
			assert.equal(helper.getStartPageRoute('search', '/', false), '/(tabs)/search')
			for (const value of ['charts', undefined, 'invalid'])
				assert.equal(helper.getStartPageRoute(value, '/', false), null)
			assert.equal(helper.getStartPageRoute('favorites', '/player', false), null)
			assert.equal(helper.getStartPageRoute('favorites', '/', true), null)
		},
	)
	await check(
		'new settings survive backup round trip and invalid preference values are rejected before writes',
		() => {
			const h = runtime(),
				backup = h.load('src/helpers/musicBackup.ts')
			h.persistence.set('app.startPage', 'favorites')
			h.persistence.set('music.favoriteAutoSave', true)
			h.persistence.set('music.favoriteOfflineQuality', '320k')
			const exported = backup.createMusicBackup('test')
			const parsed = backup.parseMusicBackup(JSON.stringify(exported))
			assert.equal(parsed.settings['app.startPage'], 'favorites')
			assert.equal(parsed.settings['music.favoriteAutoSave'], true)
			assert.equal(parsed.settings['music.favoriteOfflineQuality'], '320k')
			for (const [key, value] of [
				['app.startPage', 'other'],
				['music.favoriteAutoSave', 'true'],
				['music.favoriteOfflineQuality', 'flac24bit'],
			])
				assert.throws(
					() =>
						backup.parseMusicBackup(JSON.stringify({ ...exported, settings: { [key]: value } })),
					/Invalid backup setting/,
				)
		},
	)
} finally {
	await fixture.dispose()
}
function hooks() {
	const slots = [],
		effects = []
	let cursor = 0,
		disposed = false
	const react = {
		createElement: (type, props, ...children) => ({
			type,
			props: { ...props, children: children.flat().filter(Boolean) },
		}),
		useState: (initial) => {
			const at = cursor++
			if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial
			return [
				slots[at],
				(value) => {
					assert.equal(disposed, false)
					slots[at] = typeof value === 'function' ? value(slots[at]) : value
				},
			]
		},
		useRef: (initial) => (slots[cursor++] ??= { current: initial }),
		useMemo: (fn, deps) => {
			const at = cursor++
			if (!slots[at] || deps.some((dep, i) => dep !== slots[at].deps[i]))
				slots[at] = { deps, value: fn() }
			return slots[at].value
		},
		useEffect: (fn, deps) => {
			const at = cursor++
			if (!slots[at] || deps.some((dep, i) => dep !== slots[at].deps[i])) {
				slots[at]?.cleanup?.()
				slots[at] = { deps }
				effects.push(() => {
					slots[at].cleanup = fn()
				})
			}
		},
	}
	react.useCallback = (fn, deps) => react.useMemo(() => fn, deps)
	return {
		react,
		render: (fn) => {
			cursor = 0
			const result = fn()
			effects.splice(0).forEach((fn) => fn())
			return result
		},
		dispose: () => {
			slots.forEach((slot) => slot?.cleanup?.())
			disposed = true
		},
	}
}
const flatten = (node) =>
	typeof node === 'object' && node !== null
		? [node, ...(node.props?.children ?? []).flatMap(flatten)]
		: []
await check(
	'offline summary waits for confirmation, rechecks completed downloads and retires actions after unmount',
	async () => {
		const h = hooks(),
			alerts = [],
			queued = [],
			notices = []
		const tracks = [song('one'), song('two')]
		let rows = tracks.map((track) => ({ track, state: 'online' }))
		const missingDownloadTracks = (entries) =>
			entries.filter((row) => row.state === 'online').map((row) => row.track)
		const i18n = { t: (key, args) => (args ? `${key}:${JSON.stringify(args)}` : key) }
		const confirmation = loadModule('src/helpers/confirmPlaylistDownload.ts', {
			'react-native': { Alert: { alert: (...args) => alerts.push(args) } },
			'expo-file-system/legacy': { getFreeDiskStorageAsync: async () => 1000000 },
			'@/utils/i18n': i18n,
			'./downloadPreview': {
				getDownloadCandidates: (tracks) => tracks,
				estimateDownloadSize: () => ({ bytes: 10, unknown: 0 }),
				formatStorageBytes: (n) => String(n),
			},
		})
		const Summary = loadModule(
			'src/components/PlaylistOfflineSummary.tsx',
			{
				react: h.react,
				'react-native': { Text: 'Text', View: 'View', Pressable: 'Pressable' },
				'@/components/ActionMenu': { MenuView: 'Menu' },
				'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
				'@/utils/i18n': i18n,
				'@/helpers/downloadQuality': {
					getDownloadQuality: (event) => (event === '320k' ? event : undefined),
					getDownloadQualityActions: () => [],
				},
				'@/helpers/confirmPlaylistDownload': confirmation,
				'@/helpers/playlistOffline': {
					missingDownloadTracks,
					scanPlaylistOffline: async () => rows,
				},
				'@/helpers/trackPlayerIndex': {
					downloadPlaylist: async (tracks, options) => queued.push({ tracks, options }),
				},
				'@/utils/utils': { showToast: (...args) => notices.push(args) },
			},
			{ React: h.react },
		).PlaylistOfflineSummary
		const render = () =>
			h.render(() => Summary({ tracks, entries: rows, onlyOffline: false, onToggle() {} }))
		const menu = flatten(render()).find((node) => node.type === 'Menu')
		menu.props.onPressAction({ nativeEvent: { event: '320k' } })
		await flush()
		assert.equal(queued.length, 0)
		assert.equal(alerts.length, 1)
		rows = [
			{ track: tracks[0], state: 'available' },
			{ track: tracks[1], state: 'online' },
		]
		alerts[0][2][1].onPress()
		await flush()
		assert.deepEqual(
			queued[0].tracks.map((track) => track.id),
			['two'],
		)
		assert.equal(queued[0].options.strictQuality, true)
		const nextMenu = flatten(render()).find((node) => node.type === 'Menu')
		nextMenu.props.onPressAction({ nativeEvent: { event: '320k' } })
		await flush()
		h.dispose()
		alerts[1][2][1].onPress()
		await flush()
		assert.equal(queued.length, 1)
	},
)
await check(
	'offline filtering feeds the same verified songs to rows and play controls and leaves multi-select scoped to all songs',
	() => {
		const h = hooks(),
			tracks = [song('ready'), song('online')]
		const Playlist = loadModule(
			'src/components/PlaylistTracksList.tsx',
			{
				react: h.react,
				'@/hooks/usePlaylistOffline': {
					usePlaylistOffline: () => [
						{ track: tracks[0], state: 'available' },
						{ track: tracks[1], state: 'online' },
					],
				},
				'./PlaylistOfflineSummary': { PlaylistOfflineSummary: 'Summary' },
				'./QueueControls': { QueueControls: 'Controls' },
				'./TracksList': { TracksList: 'Tracks' },
				'@/constants/images': { unknownTrackImageUri: 'fallback' },
				'@/constants/tokens': { fontSize: { lg: 24 } },
				'@/helpers/miscellaneous': { generateTracksListId: (id) => id },
				'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
				'@/styles': { useDefaultStyles: () => ({ text: {} }) },
				'@/utils/i18n': { t: (key) => key },
				'react-native': { Text: 'Text', View: 'View', StyleSheet: { create: (x) => x } },
				'expo-image': { Image: 'Image' },
				'@/helpers/libraryEdits': { getLibraryTrackKey: (track) => track.id },
			},
			{ React: h.react },
		).PlaylistTracksList
		const render = (isMultiSelectMode = false) =>
			h.render(() =>
				Playlist({
					playlist: { id: 'favorites', title: 'Favorites' },
					tracks,
					showOfflineSummary: true,
					isMultiSelectMode,
				}),
			)
		let tree = render()
		assert.equal(tree.props.tracks.length, 2)
		flatten(tree.props.ListHeaderComponent)
			.find((node) => node.type === 'Summary')
			.props.onToggle()
		tree = render()
		assert.deepEqual(
			Array.from(tree.props.tracks, (track) => track.id),
			['ready'],
		)
		assert.deepEqual(
			Array.from(
				flatten(tree.props.ListHeaderComponent).find((node) => node.type === 'Controls').props
					.tracks,
				(track) => track.id,
			),
			['ready'],
		)
		tree = render(true)
		assert.equal(tree.props.tracks.length, 2)
	},
)
await check(
	'playlist focus hook discards stale probes, rechecks on foreground and ignores completions after leaving',
	async () => {
		const h = hooks(),
			requests = []
		let revision = 0,
			foreground
		const localTracks = [],
			favorites = []
		const hook = loadModule('src/hooks/usePlaylistOffline.ts', {
			react: h.react,
			'react-native': {
				AppState: {
					addEventListener: (_event, fn) => {
						foreground = fn
						return { remove() {} }
					},
				},
			},
			'expo-router': { useFocusEffect: (callback) => h.react.useEffect(callback, [callback]) },
			'@/helpers/playlistOffline': {
				scanPlaylistOffline: (tracks, signal) => {
					const request = { tracks, signal, ...deferred() }
					requests.push(request)
					return request.promise
				},
			},
			'@/player/PlayerStore': {
				cacheRevisionStore: { useValue: () => revision, getValue: () => revision },
				importedLocalMusicStore: { useValue: () => localTracks },
			},
			'@/store/PersistStatus': { useValue: () => favorites },
		}).usePlaylistOffline
		const tracks = [song('focus')],
			rows = [{ track: tracks[0], state: 'available' }]
		const render = () => h.render(() => hook(tracks, true))
		assert.equal(render(), null)
		revision++
		assert.equal(render(), null)
		assert.equal(requests[0].signal.aborted, true)
		requests[0].resolve(rows)
		await flush()
		assert.equal(render(), null)
		requests[1].resolve(rows)
		await flush()
		assert.equal(render(), rows)
		foreground('active')
		assert.equal(render(), null)
		h.dispose()
		requests[2].resolve(rows)
		await flush()
	},
)

finish()
