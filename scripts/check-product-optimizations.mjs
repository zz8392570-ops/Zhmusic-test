// Execute production owners with bounded transport/native seams. Run: node scripts/check-product-optimizations.mjs
import { Buffer } from 'node:buffer'
import { assert, checks, deferred, flush, loadModule } from './native-services-fixture.mjs'
import { createSourceFixture, script } from './source-runtime-fixture.mjs'

const { check, finish } = checks()
const globals = { Error }
const request = loadModule('src/helpers/requestControl.ts', {}, globals)
const audioQuality = loadModule('src/helpers/audioQuality.ts', {})
const state = (initial) => {
	let value = initial
	return {
		getValue: () => value,
		setValue: (next) => {
			value = typeof next === 'function' ? next(value) : next
		},
		useValue: () => value,
	}
}
const track = (id, platform = 'tx', extra = {}) => ({
	id,
	platform,
	title: `Song ${id}`,
	artist: 'Artist',
	album: 'Album',
	url: 'Unknown',
	duration: 180,
	...extra,
})
const until = async (condition) => {
	for (let index = 0; index < 200; index++) {
		if (condition()) return
		await new Promise((resolve) => setImmediate(resolve))
	}
	assert.fail('Owner did not reach the expected state')
}
function persistence() {
	const disk = new Map(),
		writes = []
	let failKey
	return {
		disk,
		writes,
		get: (key) => (disk.has(key) ? JSON.parse(disk.get(key)) : null),
		set: (key, value) => {
			writes.push(key)
			if (key === failKey) {
				failKey = null
				throw new Error('Storage failure')
			}
			if (value === undefined) disk.delete(key)
			else disk.set(key, JSON.stringify(value))
		},
		failOnce: (key) => {
			failKey = key
		},
	}
}
function backupFixture() {
	const store = persistence()
	const backup = loadModule('src/helpers/musicBackup.ts', {
		'@/store/PersistStatus': store,
		buffer: { Buffer },
	})
	return { ...backup, store }
}
await check(
	'cancel and deadline release request wait; late completion cannot change its result',
	async () => {
		const late = deferred(),
			controller = new AbortController()
		const pending = request.waitForRequest(() => late.promise, 1000, controller.signal)
		await flush()
		controller.abort()
		await assert.rejects(pending, { name: 'AbortError' })
		late.resolve('late')
		await flush()
		await assert.rejects(
			request.waitForRequest(() => new Promise(() => {}), 5),
			{ name: 'TimeoutError' },
		)
		assert.equal(await request.waitForRequest(async () => 'ok', 1000), 'ok')
	},
)
await check(
	'backup roundtrip keeps personal data; credentials, queue and download tasks are excluded',
	() => {
		const h = backupFixture()
		h.store.set('music.favorites', [track('one')])
		h.store.set('music.playLists', [{ id: 'list', name: 'List', folder: '通勤', pinned: true, sortOrder: 2, songs: [track('one')] }])
		h.store.set('music.quality', 'flac')
		h.store.set('music.musicApi', [{ script: 'private source' }])
		h.store.set('music.play-list', [track('queue')])
		h.store.set('music.cacheDownloads', [{ id: 'unfinished' }])
		const text = JSON.stringify(h.createMusicBackup('1.0.3'))
		const parsed = h.parseMusicBackup(text)
		assert.equal(parsed.library.favorites[0].id, 'one')
		assert.equal(parsed.settings['music.quality'], 'flac')
		assert.equal(parsed.library.playlists[0].folder, '通勤')
		assert.equal(parsed.library.playlists[0].pinned, true)
		assert.equal(parsed.library.playlists[0].sortOrder, 2)
		assert.equal(text.includes('private source'), false)
		assert.equal(text.includes('unfinished'), false)
		assert.equal(text.includes('queue'), false)
	},
)
await check(
	'merge deduplicates platform/id, merges playlist songs and leaves settings off when requested',
	() => {
		const h = backupFixture()
		h.store.set('music.favorites', [track('same'), track('old')])
		h.store.set('music.playLists', [{ id: 'list', name: 'Current', songs: [track('same')] }])
		h.store.set('music.quality', 'flac')
		const backup = h.createMusicBackup('')
		backup.library.favorites = [track('same'), track('same', 'wy')]
		backup.library.playlists = [{ id: 'list', name: 'Incoming', songs: [track('new')] }]
		backup.settings['music.quality'] = '128k'
		const library = h.restoreMusicBackup(backup, 'merge', false)
		assert.deepEqual(
			Array.from(library.favorites, (item) => `${item.platform}:${item.id}`),
			['tx:same', 'tx:old', 'wy:same'],
		)
		assert.equal(library.playlists[0].name, 'Current')
		assert.deepEqual(
			Array.from(library.playlists[0].songs, (item) => item.id),
			['same', 'new'],
		)
		assert.equal(h.store.get('music.quality'), 'flac')
	},
)
await check(
	'replace applies validated settings; unknown keys cannot overwrite source or playback state',
	() => {
		const h = backupFixture()
		h.store.set('music.favorites', [track('old')])
		h.store.set('music.selectedMusicApi', { id: 'secret' })
		const backup = h.createMusicBackup('')
		backup.library.favorites = [track('new')]
		backup.settings = { 'music.quality': '320k', 'music.selectedMusicApi': { id: 'other' } }
		h.restoreMusicBackup(backup, 'replace', true)
		assert.equal(h.store.get('music.favorites')[0].id, 'new')
		assert.equal(h.store.get('music.quality'), '320k')
		assert.equal(h.store.get('music.selectedMusicApi').id, 'secret')
	},
)
await check(
	'malformed songs, enum arrays, duplicate IDs, unsupported versions and UTF-8 oversize make zero writes',
	() => {
		const h = backupFixture()
		const good = h.createMusicBackup('')
		for (const bad of [
			{ ...good, version: 2 },
			{ ...good, settings: { 'music.quality': ['flac'] } },
			{ ...good, library: { ...good.library, favorites: [track('bad', 'tx', { url: 7 })] } },
			{
				...good,
				library: {
					...good.library,
					playlists: [
						{ id: 'a', name: 'A', songs: [] },
						{ id: 'a', name: 'B', songs: [] },
					],
				},
			},
		])
			assert.throws(() => h.restoreMusicBackup(bad, 'replace', true))
		assert.throws(() => h.parseMusicBackup('{broken'))
		assert.throws(
			() => h.parseMusicBackup(JSON.stringify({ ...good, extra: '中'.repeat(4_000_000) })),
			/size limit/,
		)
		assert.equal(h.store.writes.length, 0)
	},
)
await check(
	'a failed restore rolls back earlier writes and keeps the previous personal library',
	() => {
		const h = backupFixture()
		h.store.set('music.favorites', [track('old')])
		h.store.set('music.playLists', [{ id: 'old', name: 'Old', songs: [] }])
		const before = [...h.store.disk]
		const backup = h.createMusicBackup('')
		backup.library.favorites = [track('new')]
		h.store.failOnce('music.playLists')
		assert.throws(() => h.restoreMusicBackup(backup, 'replace', true), /Storage failure/)
		assert.deepEqual([...h.store.disk], before)
	},
)
await check(
	'personal search matches song/artist/album and labels all matching collection memberships',
	() => {
		const { searchPersonalLibrary } = loadModule('src/helpers/personalLibrarySearch.ts', {})
		const song = track('a', 'tx', { title: '晴天', artist: '周杰伦', album: '叶惠美' })
		const collections = [
			{ id: 'favorites', title: '喜欢', songs: [song] },
			{ id: 'p', title: '通勤', songs: [song, track('b', 'wy')] },
		]
		for (const word of ['晴天', '周杰伦', '叶惠美']) {
			const result = searchPersonalLibrary(collections, word)
			assert.equal(result.tracks.length, 1)
			assert.equal(result.tracks[0].collections.length, 2)
		}
		assert.equal(searchPersonalLibrary(collections, '通勤').playlists[0].id, 'p')
		assert.equal(searchPersonalLibrary(collections, '不存在').tracks.length, 0)
	},
)
await check('library playlists sort by pin, folder and stable manual order', () => {
	const { sortLibraryPlaylists } = loadModule('src/helpers/playlistOrganizer.ts', {})
	const playlists = [
		{ id: 'c', folder: 'B', sortOrder: 0 },
		{ id: 'b', folder: 'A', sortOrder: 2 },
		{ id: 'a', folder: 'A', sortOrder: 1 },
		{ id: 'p', folder: 'Z', pinned: true, sortOrder: 9 },
	]
	assert.deepEqual(Array.from(sortLibraryPlaylists(playlists), (item) => item.id), ['p', 'a', 'b', 'c'])
})
function searchFixture() {
	const qq = deferred(),
		http = [],
		updates = []
	const api = loadModule(
		'src/helpers/crossPlatformSearch.ts',
		{
			'@/components/utils/common': { decodeName: (value) => value },
			'@/components/utils/musicSdk/utils': { toMD5: () => 'fixture' },
			'@/constants/images': { unknownTrackImageUri: 'cover' },
			'./userApi/xiaoqiu': { searchMusic: () => qq.promise },
			'./requestControl': request,
		},
		{
			...globals,
			fetch: (url) => {
				const job = deferred()
				http.push({ url, ...job })
				return job.promise
			},
		},
	)
	const reply = (job, body) => job.resolve({ ok: true, text: async () => JSON.stringify(body) })
	return { ...api, qq, http, updates, reply }
}
await check(
	'fast platform is playable while four slow platforms are pending; late duplicates keep its ID',
	async () => {
		const h = searchFixture()
		const pending = h.searchSongsAcrossPlatforms('晴天', 1, 'all', (result) =>
			h.updates.push(result),
		)
		await flush()
		const fast = h.http.find((job) => job.url.includes('kuwo'))
		h.reply(fast, {
			TOTAL: 11,
			abslist: [{ MUSICRID: 'MUSIC_fast', SONGNAME: '晴天', ARTIST: '周杰伦', DURATION: 180 }],
		})
		await until(() => h.updates.some((result) => result.data.length))
		assert.equal(h.updates.at(-1).data[0].id, 'fast')
		assert.equal(h.updates.at(-1).pendingPlatforms.length, 4)
		h.qq.resolve({ data: [track('slow', 'tx', { title: '晴天', artist: '周杰伦' })], isEnd: true })
		for (const job of h.http.filter((job) => job !== fast))
			job.reject(new Error('Offline platform'))
		const result = await pending
		assert.equal(result.data.length, 1)
		assert.equal(result.data[0].id, 'fast')
		assert.equal(result.data[0].sourceAlternatives[0].id, 'slow')
		assert.equal(result.unavailablePlatforms.length, 3)
		assert.equal(result.pendingPlatforms.length, 0)
		assert.equal(result.hasMore, true)
	},
)
await check(
	'dedup keeps interleaved recording positions, live/remix versions and source alternatives',
	() => {
		const h = searchFixture()
		const a = track('a', 'kw', { title: 'Same' }),
			b = track('b'),
			live = track('live', 'kg', { title: 'Same', duration: 220 })
		const result = h.deduplicateCrossPlatformTracks([
			a,
			b,
			live,
			track('late', 'tx', { title: 'Same' }),
			track('remix', 'wy', { title: 'Same Remix' }),
		])
		assert.deepEqual(
			Array.from(result, (item) => item.id),
			['a', 'b', 'live', 'remix'],
		)
		assert.equal(result[0].sourceAlternatives[0].id, 'late')
	},
)
function resolverFixture(getUrl) {
	const selected = { id: 'primary', name: 'Primary' },
		backup = { id: 'backup', name: 'Backup' }
	const store = persistence(),
		progress = [],
		notices = [],
		calls = []
	const stores = {
		qualityStore: state('flac'),
		musicApiSelectedStore: state(selected),
		musicApiStore: state([selected, backup]),
		nowApiState: state(null),
	}
	const health = {
		MAX_FAILOVER_SOURCES: 3,
		isValidMusicUrl: (url) => /^https?:/.test(url),
		getFailoverCandidates: (apis, id) => apis.filter((api) => api.id !== id),
	}
	const controls = {
		getMusicFailureKey: (song) => song.id,
		getFailedApiIds: () => new Set(),
		rememberFailedApi() {},
		recordMusicApiAttempt() {},
		requestMusicUrlFromApi: (api, song, quality, timeout, context, signal) => {
			calls.push({ api, song, quality, signal })
			return getUrl(api, quality, signal)
		},
		setMusicApiAsSelectedById: async (id) => {
			const api = stores.musicApiStore.getValue().find((item) => item.id === id)
			stores.musicApiSelectedStore.setValue(api)
			return api
		},
	}
	const resolver = loadModule(
		'src/player/MusicSourceResolver.ts',
		{
			'@/constants/images': { fakeAudioMp3Uri: 'fixture://fake' },
			'@/helpers/logger': { logInfo() {}, logError() {} },
			'@/helpers/localFile': { resolveLocalFile: async () => ({ status: 'nonlocal' }) },
			'@/helpers/requestControl': request,
			'@/helpers/audioQuality': audioQuality,
			'@/helpers/userApi/musicApiControl': controls,
			'@/helpers/userApi/musicSourceHealth': health,
			'@/helpers/userApi/sourceDiagnostics': {
				appendSourceDiagnostic() {},
				classifySourceError(error) {
					return /timeout|超时/i.test(String(error?.message ?? error)) ? 'timeout' : 'unknown'
				},
				getSourceErrorMessage() {
					return '获取音源失败，请换源或重试。'
				},
			},
			'@/utils/sourceSwitchNotice': {
				showAutomaticSourceSwitchNotice: (...args) => notices.push(args),
			},
			'@/utils/utils': { showToast: (...args) => notices.push(args) },
			'./CacheManager': { getCachedAudioInfo: async () => null },
			'./PlayerStore': stores,
			'@/player/PlayerStore': stores,
			'@/store/PersistStatus': store,
		},
		globals,
	)
	return { ...resolver, store, stores, calls, notices, progress }
}
await check(
	'quality fallback changes actual quality only; the following song starts at preferred FLAC',
	async () => {
		const h = resolverFixture(async (_api, quality) =>
			quality === 'flac' ? '' : 'https://audio.test/song.mp3',
		)
		const result = await h.resolveSource(track('first'), {
			onProgress: (event) => h.progress.push(event),
		})
		assert.equal(result.quality, '320k')
		assert.equal(h.stores.qualityStore.getValue(), 'flac')
		assert.equal(h.store.writes.includes('music.quality'), false)
		assert.equal(h.progress.at(-1).stage, 'retryingQuality')
		assert.deepEqual(h.calls.slice(0, 2).map((call) => call.quality), ['flac', 'flac'])
		await h.resolveSource(track('next'))
		assert.equal(h.calls[3].quality, 'flac')
	},
)
await check(
	'source total deadline ends an uncooperative request without late state changes or failover',
	async () => {
		const late = deferred(),
			h = resolverFixture(() => late.promise)
		await assert.rejects(h.resolveSource(track('slow'), { totalTimeoutMs: 5 }), {
			name: 'TimeoutError',
		})
		assert.equal(h.calls.length, 1)
		assert.equal(h.calls[0].signal.aborted, true)
		late.resolve('https://audio.test/late.mp3')
		await flush()
		assert.equal(h.calls.length, 1)
		assert.equal(h.notices.length, 0)
		assert.equal(h.stores.nowApiState.getValue(), null)
	},
)
await check(
	'LX cancellation aborts associated HTTP and rejects later HTTP from the cancelled parent',
	async () => {
		const fetchCalls = []
		const f = createSourceFixture({
			fetch: (url, options) => {
				fetchCalls.push({ url, options })
				return new Promise(() => {})
			},
		})
		const adapting = f.adapter.adaptLxMusicScript(script('Cancel'))
		await flush()
		f.native.emit('init', { status: true })
		const api = await adapting,
			controller = new AbortController()
		const pending = api.getMusicUrl('Title', 'Artist', 'song', 'flac', {
			requestType: 'current',
			signal: controller.signal,
		})
		const wire = f.native.sent.at(-1).data.requestKey
		f.native.emit('request', {
			requestKey: 'http',
			parentRequestKey: wire,
			url: 'https://http.test/a',
			options: { timeout: 1000 },
		})
		controller.abort()
		await assert.rejects(pending, /取消/)
		assert.equal(fetchCalls[0].options.signal.aborted, true)
		f.native.emit('request', {
			requestKey: 'late-http',
			parentRequestKey: wire,
			url: 'https://http.test/late',
			options: { timeout: 1000 },
		})
		assert.equal(fetchCalls.length, 1)
		assert.equal(f.native.sent.at(-1).data.error, 'Cancelled')
		f.facade.destroy()
		assert.equal(f.clock.timers.size, 0)
	},
)

function downloadFixture() {
	const store = persistence(),
		jobs = [],
		sources = [],
		pins = [],
		cancelled = [],
		files = new Set(),
		toasts = []
	const stores = {
		qualityStore: state('320k'),
		autoCacheLocalStore: state(true),
		autoCacheWifiOnlyStore: state(false),
		cacheDownloadTasksStore: state([]),
		importedLocalMusicStore: state([]),
	}
	const cache = {
		getLocalFilePath: (song, quality) =>
			`file:///Documents/musicCache/${song.platform}_${song.id}.${quality === 'flac' ? 'flac' : 'mp3'}`,
		getCacheFileUri: (value) => value,
		getCachedAudioInfo: async (song) =>
			files.has(cache.getLocalFilePath(song))
				? { localPath: cache.getLocalFilePath(song), quality: '320k' }
				: null,
		migrateCacheRetention: async () => {},
		markSavedOffline: (value) => pins.push(value),
		enforceAutomaticCacheLimit: async () => {},
		downloadToCache: (song, quality, progress, id) => {
			const job = deferred()
			jobs.push({ song, quality, progress, id, ...job })
			return job.promise
		},
	}
	const api = loadModule(
		'src/player/DownloadManager.ts',
		{
			'expo-network': {
				NetworkStateType: { WIFI: 'wifi' },
				getNetworkStateAsync: async () => ({ type: 'wifi' }),
			},
			'expo-file-system/legacy': { getInfoAsync: async (path) => ({ exists: files.has(path) }) },
			'@/store/PersistStatus': store,
			'@/utils/i18n': { t: (key) => key },
			'@/utils/utils': { showToast: (...args) => toasts.push(args) },
			'@/helpers/fileDownload': {
				cancelDownload: async (id) => {
					cancelled.push(id)
					jobs.find((job) => job.id === id)?.reject(new Error('Cancelled'))
				},
				clearDownloadCancellation() {},
			},
			'@/helpers/requestControl': request,
			'@/constants/images': { fakeAudioMp3Uri: 'fixture://fake' },
			'@/helpers/localFile': { resolveLocalFile: async () => ({ status: 'nonlocal' }) },
			'./CacheManager': cache,
			'./MusicSourceResolver': {
				resolveSource: async (song, options) => {
					sources.push({ song, options })
					return { url: `https://fresh.test/${song.id}`, quality: '320k' }
				},
			},
			'./PlayerStore': stores,
		},
		globals,
	)
	const complete = (job) => {
		const path = cache.getLocalFilePath(job.song, job.quality)
		files.add(path)
		job.resolve(path)
	}
	return { ...api, store, stores, jobs, sources, pins, cancelled, files, cache, complete, toasts }
}
await check(
	'download queue has at most two workers; cancelling a queued item does not start it',
	async () => {
		const h = downloadFixture()
		for (const id of ['a', 'b', 'c', 'd']) await h.enqueueDownload(track(id), { silent: true })
		await until(() => h.jobs.length === 2)
		const c = h.stores.cacheDownloadTasksStore.getValue().find((task) => task.track.id === 'c')
		await h.cancelCacheTask(c.id)
		h.complete(h.jobs[0])
		h.complete(h.jobs[1])
		await until(() => h.jobs.length === 3)
		assert.equal(h.jobs[2].song.id, 'd')
		assert.equal(
			h.sources.some((item) => item.song.id === 'c'),
			false,
		)
		h.complete(h.jobs[2])
		await until(
			() =>
				h.stores.cacheDownloadTasksStore.getValue().filter((task) => task.status === 'completed')
					.length === 3,
		)
		assert.equal(h.stores.importedLocalMusicStore.getValue().length, 3)
		assert.equal(h.pins.length, 3)
	},
)
await check(
	'manual promotion survives later progress and is retained offline at commit',
	async () => {
		const h = downloadFixture(),
			song = track('promotion')
		await h.enqueueDownload(song, { kind: 'automatic', silent: true })
		await until(() => h.jobs.length === 1)
		await h.enqueueDownload(song, { kind: 'saved', silent: true })
		h.jobs[0].progress(0.5)
		assert.equal(h.stores.cacheDownloadTasksStore.getValue()[0].kind, 'saved')
		assert.equal(
			h.getProtectedDownloadPaths().includes(h.cache.getLocalFilePath(song, '320k')),
			true,
		)
		h.complete(h.jobs[0])
		await until(() => h.stores.cacheDownloadTasksStore.getValue()[0].status === 'completed')
		assert.equal(h.stores.importedLocalMusicStore.getValue()[0].cacheKind, 'saved')
		assert.equal(h.pins.length, 1)
	},
)
await check('cancelled running download cannot import a late completion', async () => {
	const h = downloadFixture()
	await h.enqueueDownload(track('cancel'), { silent: true })
	await until(() => h.jobs.length === 1)
	await h.cancelCacheTask(h.jobs[0].id)
	h.complete(h.jobs[0])
	await flush()
	assert.equal(h.stores.importedLocalMusicStore.getValue().length, 0)
	assert.equal(h.stores.cacheDownloadTasksStore.getValue()[0].status, 'cancelled')
})
await check(
	'restart restores pending tasks as interrupted; continuation refreshes stale URLs',
	async () => {
		const h = downloadFixture()
		const saved = {
			id: 'restore',
			track: track('resume', 'tx', { url: 'https://expired.test/song' }),
			quality: '320k',
			status: 'downloading',
			progress: 0.4,
			kind: 'saved',
		}
		h.store.set('music.cacheDownloads', [saved, { ...saved, id: 'bad', quality: null }, saved])
		h.restoreDownloadTasks()
		assert.equal(h.stores.cacheDownloadTasksStore.getValue().length, 1)
		assert.equal(h.stores.cacheDownloadTasksStore.getValue()[0].status, 'interrupted')
		assert.equal(h.jobs.length, 0)
		h.resumeCacheTasks()
		await until(() => h.jobs.length === 1)
		assert.equal(h.sources[0].song.url, 'Unknown')
		assert.equal(h.jobs[0].song.url, 'https://fresh.test/resume')
		h.complete(h.jobs[0])
		await until(() => h.stores.cacheDownloadTasksStore.getValue()[0].status === 'completed')
	},
)
await check(
	'offline requests made during cache clear remain queued and start after cleanup',
	async () => {
		const h = downloadFixture(),
			clearing = deferred()
		const pending = h.clearAutomaticDownloads(() => clearing.promise)
		await flush()
		await h.enqueueDownload(track('during-clear'), { silent: true })
		assert.equal(h.stores.cacheDownloadTasksStore.getValue()[0].status, 'queued')
		assert.equal(h.jobs.length, 0)
		clearing.resolve()
		await pending
		await until(() => h.jobs.length === 1)
		h.complete(h.jobs[0])
		await until(() => h.stores.cacheDownloadTasksStore.getValue()[0].status === 'completed')
	},
)

function retentionFixture() {
	const store = persistence(),
		files = new Map(),
		deleted = [],
		unsafe = new Set()
	const stores = {
		qualityStore: state('320k'),
		cacheRevisionStore: state(0),
		importedLocalMusicStore: state([]),
	}
	const cacheDir = 'file:///Documents/musicCache/',
		path = (name) => `${cacheDir}${name}`
	const fs = {
		documentDirectory: 'file:///Documents/',
		getInfoAsync: async (value) =>
			value === cacheDir
				? { exists: true, isDirectory: true }
				: files.has(value)
					? { exists: true, isDirectory: false, ...files.get(value) }
					: { exists: false },
		readDirectoryAsync: async () => [...files.keys()].map((value) => value.slice(cacheDir.length)),
		deleteAsync: async (value) => {
			deleted.push(value)
			files.delete(value)
		},
	}
	const local = {
		fileUriFromPath: (value) => `file://${value.split('/').map(encodeURIComponent).join('/')}`,
		resolveLocalFile: async (value) =>
			unsafe.has(value)
				? { status: 'unresolved', reason: 'unsafe-path' }
				: typeof value === 'string' && files.has(value)
					? {
							status: 'resolved',
							fileUri: value,
							filePath: decodeURIComponent(value.slice('file://'.length)),
						}
					: { status: 'nonlocal' },
	}
	const cache = loadModule('src/player/CacheManager.ts', {
		'@/helpers/logger': { logInfo() {}, logError() {} },
		'./PlayerStore': stores,
		'@/store/PersistStatus': store,
		'expo-file-system/legacy': fs,
		'@/helpers/fileDownload': { downloadFile() {} },
		'@/helpers/localFile': local,
		'../../modules/cymusic-native': { documentDirectoryPath: '/Documents' },
		'@/helpers/audioQuality': audioQuality,
	})
	return { ...cache, store, files, deleted, unsafe, stores, path }
}
await check(
	'automatic clear retains manual saves, legacy downloads, playing files and unsafe targets',
	async () => {
		const h = retentionFixture()
		for (const name of ['saved.mp3', 'legacy.mp3', 'automatic.mp3', 'playing.mp3', 'link.mp3'])
			h.files.set(h.path(name), { size: 1 })
		h.markSavedOffline(h.path('saved.mp3'))
		h.stores.importedLocalMusicStore.setValue([
			track('legacy', 'tx', { url: h.path('legacy.mp3') }),
			track('automatic', 'tx', { url: h.path('automatic.mp3'), cacheKind: 'automatic' }),
		])
		h.unsafe.add(h.path('link.mp3'))
		await h.clearCache([h.path('playing.mp3')])
		assert.deepEqual(h.deleted, [h.path('automatic.mp3')])
		assert.equal(h.stores.importedLocalMusicStore.getValue().length, 1)
		assert.equal(h.store.get('music.savedOffline')['legacy.mp3'], true)
	},
)
await check(
	'capacity evicts oldest automatic files and excludes manually retained offline files',
	async () => {
		const h = retentionFixture(),
			mb = 1024 * 1024
		h.store.set('music.cacheLimitMB', 256)
		for (const [name, modified] of [
			['saved.mp3', 0],
			['older.mp3', 1],
			['newer.mp3', 2],
		])
			h.files.set(h.path(name), { size: 200 * mb, modificationTime: modified })
		h.markSavedOffline(h.path('saved.mp3'))
		await h.enforceAutomaticCacheLimit()
		assert.deepEqual(h.deleted, [h.path('older.mp3')])
		assert.equal(h.files.has(h.path('saved.mp3')), true)
		assert.equal(h.files.has(h.path('newer.mp3')), true)
	},
)
await check(
	'saved cache references with imported IDs still resolve their existing owned audio file',
	async () => {
		const h = retentionFixture()
		h.files.set(h.path('tx_original.mp3'), { size: 10 })
		const cached = await h.getCachedAudioInfo(
			track('cache:tx:original', 'tx', { url: h.path('tx_original.mp3') }),
			true,
		)
		assert.equal(cached.localPath, h.path('tx_original.mp3'))
		assert.equal(cached.quality, 'mp3')
	},
)
finish()
