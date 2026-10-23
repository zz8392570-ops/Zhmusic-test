import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { assert, checks, deferred, flush, loadModule } from './native-services-fixture.mjs'
import { createFixture, item, pathFromUri, write } from './file-system-fixture.mjs'
const { check, finish } = checks(),
	fixture = createFixture(),
	require = createRequire(import.meta.url)
const groups = loadModule('src/helpers/favoriteGroups.ts', {})
const data = loadModule('src/helpers/personalFeatures.ts', { './favoriteGroups': groups })
const weighted = loadModule('src/helpers/smartShuffle.ts', { './favoriteGroups': groups })
const song = (id, extra = {}) =>
	item(id, 'Unknown', { platform: 'tx', title: id, artist: 'Singer', duration: 200, ...extra })
await check(
	'smart shuffle keeps every entry and favors forgotten favorites over recently heard recordings',
	() => {
		const recent = song('recent'),
			normal = song('normal'),
			forgotten = song('forgotten'),
			now = 100 * 86400_000
		const tracks = [recent, normal, forgotten],
			records = [
				{ track: recent, lastPlayedAt: now - 3600_000 },
				{ track: forgotten, lastPlayedAt: now - 60 * 86400_000 },
			]
		let seed = 713,
			recentFirst = 0,
			forgottenFirst = 0
		const random = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0
			return seed / 2 ** 32
		}
		for (let index = 0; index < 1200; index++) {
			const result = weighted.smartShuffle(tracks, records, [forgotten], random, now)
			assert.equal(new Set(result).size, 3)
			assert.ok(result.every((track) => tracks.includes(track)))
			recentFirst += result[0] === recent
			forgottenFirst += result[0] === forgotten
		}
		assert.ok(recentFirst < 130)
		assert.ok(forgottenFirst > 650)
		assert.deepEqual(
			tracks.map((track) => track.id),
			['recent', 'normal', 'forgotten'],
		)
		const wrapper = loadModule('src/helpers/shuffleForListening.ts', {
			'lodash.shuffle': (tracks) => [...tracks].reverse(),
			'@/store/PersistStatus': { get: () => null },
			'./smartShuffle': weighted,
		})
		assert.deepEqual(
			Array.from(wrapper.shuffleForListening(tracks), (track) => track.id),
			['forgotten', 'normal', 'recent'],
		)
	},
)
await check(
	'tags normalize without conflating songs, edit grouped labels together and preserve unrelated identities',
	() => {
		const a = song('a'),
			b = song('b', { platform: 'kw', title: 'a' }),
			unrelated = song('unrelated'),
			group = groups.mergeFavoriteGroup([a, b])
		const initial = {
			[data.personalTrackKey(a)]: ['粤语'],
			[data.personalTrackKey(b)]: ['怀旧'],
			[data.personalTrackKey(unrelated)]: ['开车'],
		}
		assert.deepEqual(Array.from(data.getTrackTags(b, initial, [group])), ['粤语', '怀旧'])
		const updated = data.updateTrackTags(b, initial, [' 通勤 ', '通勤', 'ＡＢＣ', 'abc'], [group])
		assert.deepEqual(Array.from(data.getTrackTags(a, updated, [group])), ['通勤', 'abc'])
		assert.deepEqual(Array.from(data.getTrackTags(unrelated, updated, [group])), ['开车'])
		assert.equal(
			data.getTrackTags(song('cached-a', { originalId: 'a' }), updated, [group]).length,
			2,
		)
		assert.equal(
			data.getTrackTags(a, data.updateTrackTags(a, updated, [], [group]), [group]).length,
			0,
		)
		assert.throws(() => data.updateTrackTags(a, {}, ['x'.repeat(33)]), /Invalid/)
		assert.throws(
			() =>
				data.updateTrackTags(
					a,
					{},
					Array.from({ length: 17 }, (_, i) => String(i)),
				),
			/Invalid/,
		)
		assert.equal(data.isValidTrackTags({ bad: ['x'] }), false)
		assert.equal(data.personalTracks([group], [{ songs: [a, b, unrelated] }], []).length, 2)
	},
)
function sceneRuntime() {
	const gate = deferred(),
		calls = [],
		disk = new Map([['music.favorites', [song('a'), song('b')]]])
	let revision = 0,
		timerAllowed = true,
		scan = async (tracks) =>
			tracks.map((track) => ({ track, state: track.id === 'a' ? 'available' : 'online' }))
	const player = {
		getPlaybackRevision: () => revision,
		setRepeatMode: (mode) => calls.push(['mode', mode]),
		playWithReplacePlayList: async (...args) => calls.push(['play', ...args]),
		continueLastSession: async () => {
			calls.push(['resume'])
			return true
		},
	}
	const persist = { get: (key) => disk.get(key) ?? null }
	const scenes = loadModule('src/helpers/listeningSceneActions.ts', {
		'@/store/PersistStatus': persist,
		'./trackPlayerIndex': {
			__esModule: true,
			default: player,
			MusicRepeatMode: { SHUFFLE: 'shuffle', QUEUE: 'queue' },
		},
		'./playlistOffline': { scanPlaylistOffline: (...args) => scan(...args) },
		'./personalFeatures': data,
		'@/utils/timingClose': {
			setTimingClose: (deadline) => {
				calls.push(['timer', deadline])
				return timerAllowed
			},
		},
		'@/utils/i18n': { t: (key) => key },
	})
	return {
		...scenes,
		gate,
		calls,
		disk,
		player,
		changeRevision: () => revision++,
		denyTimer: () => {
			timerAllowed = false
		},
		holdScan: () => {
			scan = () => gate.promise
		},
	}
}
await check(
	'scene execution uses the configured collection, verified offline subset and timer, and rejects deleted/empty data',
	async () => {
		const h = sceneRuntime(),
			scene = data.defaultScenes('Commute', 'Sleep')[0]
		assert.equal(data.isValidScenes([scene]), true)
		assert.equal(await h.startListeningScene(scene), true)
		const play = h.calls.find((call) => call[0] === 'play')
		assert.equal(play[2].length, 1)
		assert.equal(play[2][0].id, 'a')
		assert.equal(play[3], true)
		assert.equal(h.calls[0][0], 'timer')
		assert.equal(h.calls[0][1], null)
		h.disk.set('music.favorites', [])
		await assert.rejects(h.startListeningScene(scene), /noSongs/)
		await assert.rejects(
			h.startListeningScene({ ...scene, collectionId: 'missing' }),
			/collectionGone/,
		)
		const denied = sceneRuntime()
		denied.denyTimer()
		await assert.rejects(
			denied.startListeningScene({ ...scene, offlineOnly: false, sleepMinutes: 30 }),
			/timerFailed/,
		)
		assert.equal(
			denied.calls.some((call) => call[0] === 'play'),
			false,
		)
		for (const bad of [
			{ ...scene, sleepMinutes: 181 },
			{ ...scene, name: '' },
			{ ...scene, shuffle: 'true' },
		])
			assert.equal(data.isValidScenes([bad]), false)
	},
)
await check(
	'a scene never starts after cancellation, transport changes or collection edits during scanning',
	async () => {
		for (const mode of ['abort', 'transport', 'collection', 'retired']) {
			const h = sceneRuntime(),
				signal = new AbortController(),
				scene = data.defaultScenes('Commute', 'Sleep')[0]
			h.holdScan()
			const pending = h.startListeningScene(scene, signal.signal)
			if (mode === 'abort') signal.abort()
			else if (mode === 'transport') h.changeRevision()
			else if (mode === 'collection') h.disk.set('music.favorites', [])
			else h.cancelSceneStart()
			h.gate.resolve([{ track: song('a'), state: 'available' }])
			assert.equal(await pending, false)
			assert.equal(h.calls.length, 0)
		}
	},
)
await check(
	'widget links and shortcut commands resolve exact latest collections and reject unknown inputs',
	async () => {
		const h = sceneRuntime(),
			links = loadModule('src/helpers/personalLinks.ts', {
				'./trackPlayerIndex': {
					__esModule: true,
					default: h.player,
					MusicRepeatMode: { QUEUE: 'queue' },
				},
				'./listeningSceneActions': h,
				'@/utils/i18n': { t: (key) => key },
			})
		await links.executePersonalLink('resume')
		assert.equal(h.calls[0][0], 'resume')
		await links.executePersonalLink('favorites')
		assert.equal(h.calls.at(-1)[0], 'play')
		const id = 'playlist & # 中文'
		h.disk.set('music.playLists', [{ id, songs: [song('special')] }])
		await links.executePersonalLink('playlist', id)
		assert.equal(h.calls.at(-1)[1].id, 'special')
		await assert.rejects(links.executePersonalLink('playlist', 'deleted'), /collectionGone/)
		await assert.rejects(links.executePersonalLink('scene', 'deleted'), /sceneGone/)
		await assert.rejects(links.executePersonalLink('unknown', id), /invalidLink/)
		const owner = new AbortController()
		owner.abort()
		const before = h.calls.length
		assert.equal(await links.executePersonalLink('favorites', undefined, owner.signal), false)
		assert.equal(h.calls.length, before)
	},
)
await check(
	'widget snapshots contain bounded metadata and exact IDs, preserve the selected playlist and omit source secrets',
	() => {
		const helper = loadModule('src/helpers/widgetSnapshot.ts', {})
		const playlists = Array.from({ length: 1000 }, (_, i) => ({
			id: `p-${i}`,
			name: 'x'.repeat(1000),
			songs: [],
		}))
		const result = helper.buildWidgetSnapshot(
			song('song', {
				url: 'https://audio.test/?token=private',
				artwork: 'private-cover',
				title: 'Now playing',
			}),
			playlists,
			5,
			data.defaultScenes('Commute', 'Sleep'),
			'p-999',
			'zh',
		)
		assert.equal(result.selected, 'p-999')
		assert.ok(result.collections.some((item) => item.id === 'p-999'))
		assert.ok(result.collections.length <= 101)
		assert.ok(Buffer.byteLength(JSON.stringify(result)) < 256 * 1024)
		assert.equal(JSON.stringify(result).includes('private'), false)
		assert.equal(helper.buildWidgetSnapshot(null, [], 0, [], 'gone', 'en').selected, 'favorites')
	},
)
try {
	await check(
		'prepared lyrics persist in real files, reuse original IDs and survive a fresh module without online requests',
		async () => {
			const h = fixture.runtime({ realCache: true }),
				assets = h.load('src/helpers/offlineAssets.ts'),
				track = song('assets-lyric'),
				lyric = { rawLrc: '[00:01.00]One line', translation: '[00:01.00]一行' }
			assert.equal(await assets.saveOfflineLyric(track, { rawLrc: '[00:00.00]暂无歌词' }), false)
			assert.equal(await assets.saveOfflineLyric(track, lyric), true)
			const fresh = fixture.runtime({ realCache: true }).load('src/helpers/offlineAssets.ts')
			const cached = { ...track, id: 'collision-safe-copy', originalId: track.id }
			assert.equal(
				(
					await fresh.getPreparedLyric(cached, async () => {
						throw Error('Must stay offline')
					})
				).translation,
				lyric.translation,
			)
			assert.equal(await fresh.readOfflineLyric(song('assets-lyric', { platform: 'kw' })), null)
			const owner = new AbortController()
			owner.abort()
			assert.equal(
				await assets.saveOfflineLyric(song('cancelled-lyric'), lyric, owner.signal),
				false,
			)
			assert.equal(await assets.readOfflineLyric(song('cancelled-lyric')), null)
		},
	)
	await check(
		'artwork preparation respects response limits, uses real files and becomes available without a remote URL',
		async () => {
			const h = fixture.runtime({ realCache: true }),
				assets = h.load('src/helpers/offlineAssets.ts'),
				track = song('cover-ready'),
				original = globalThis.fetch
			const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
			try {
				globalThis.fetch = async () => ({
					ok: true,
					headers: new Headers({ 'content-type': 'image/png' }),
					arrayBuffer: async () => bytes.buffer,
				})
				assert.equal(await assets.saveOfflineArtwork(track, 'https://image.test/cover'), true)
				const address = await assets.readOfflineArtwork(track)
				assert.ok(address)
				assert.deepEqual(new Uint8Array(await fs.readFile(pathFromUri(address))), bytes)
				globalThis.fetch = async () => ({
					ok: true,
					headers: new Headers({ 'content-type': 'text/html' }),
					arrayBuffer: async () => bytes.buffer,
				})
				assert.equal(
					await assets.saveOfflineArtwork(song('html-cover'), 'https://image.test/cover'),
					false,
				)
				assert.equal(await assets.hasOfflineAsset(song('html-cover'), 'artwork'), false)
			} finally {
				globalThis.fetch = original
			}
		},
	)
	await check(
		'trip preparation retains available cached audio, saves successful metadata and skips network on cellular',
		async () => {
			let type = 'wifi',
				lyricCalls = 0
			const original = globalThis.fetch
			const h = fixture.runtime({
				realCache: true,
				moduleOverrides: {
					'expo-network': {
						NetworkStateType: { WIFI: 'wifi', ETHERNET: 'ethernet' },
						getNetworkStateAsync: async () => ({ type }),
						addNetworkStateListener: () => ({ remove() {} }),
					},
					'@/helpers/userApi/getMusicLyric': {
						myGetLyric: async () => {
							lyricCalls++
							return { rawLrc: '[00:01.00]Ready' }
						},
					},
				},
			})
			try {
				globalThis.fetch = async () => ({
					ok: true,
					headers: new Headers({ 'content-type': 'image/png' }),
					arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
				})
				const track = song('trip-ready', { artwork: 'https://image.test/cover' }),
					cache = h.load('src/player/CacheManager.ts'),
					helper = h.load('src/helpers/travelPreparation.ts')
				h.hooks.download = async ({ fileUri }) => {
					await write(pathFromUri(fileUri), 'audio bytes')
					return { uri: fileUri, status: 200, headers: {} }
				}
				const path = await cache.downloadToCache(
					{ ...track, url: 'https://audio.test/file' },
					'128k',
				)
				h.stores.importedLocalMusicStore.setValue([{ ...track, url: path, cacheKind: 'automatic' }])
				const entries = await helper.inspectTravelCollection([track], new AbortController().signal)
				assert.equal(entries[0].audio, true)
				assert.equal(entries[0].lyric, false)
				const updates = []
				await helper.prepareTravelMetadata(entries, new AbortController().signal, (...args) =>
					updates.push(args),
				)
				assert.equal(lyricCalls, 1)
				assert.equal(h.stores.importedLocalMusicStore.getValue()[0].cacheKind, 'saved')
				assert.ok(Object.keys(h.persistence.get('music.savedOffline')).length)
				const verified = await helper.inspectTravelCollection([track], new AbortController().signal)
				assert.equal(verified[0].lyric, true)
				assert.equal(verified[0].artwork, true)
				type = 'cellular'
				await assert.rejects(
					helper.prepareTravelMetadata(entries, new AbortController().signal, () => {}),
					/WIFI_REQUIRED/,
				)
				assert.equal(lyricCalls, 1)
			} finally {
				globalThis.fetch = original
			}
		},
	)
	await check(
		'trip cancellation retires late lyric results and cannot publish a newly prepared file',
		async () => {
			const gate = deferred(),
				owner = new AbortController(),
				track = song('late-pack')
			const h = fixture.runtime({
				realCache: true,
				moduleOverrides: {
					'expo-network': {
						NetworkStateType: { WIFI: 'wifi' },
						getNetworkStateAsync: async () => ({ type: 'wifi' }),
						addNetworkStateListener: () => ({ remove() {} }),
					},
					'@/helpers/userApi/getMusicLyric': { myGetLyric: async () => gate.promise },
				},
			})
			const helper = h.load('src/helpers/travelPreparation.ts'),
				assets = h.load('src/helpers/offlineAssets.ts')
			const pending = helper.prepareTravelMetadata(
				[{ track, audio: false, lyric: false, artwork: true, unknown: false }],
				owner.signal,
				() => {
					throw Error('Late progress')
				},
			)
			await flush()
			owner.abort()
			gate.resolve({ rawLrc: '[00:01.00]Late' })
			await pending
			assert.equal(await assets.readOfflineLyric(track), null)
		},
	)
	await check(
		'trip Wi-Fi policy upgrades an active manual task before transfer and survives restoration',
		async () => {
			const gate = deferred(),
				networkListeners = new Set()
			let network = { type: 'cellular' },
				requested = 0
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
						resolveSource: async () => {
							requested++
							return requested === 1
								? gate.promise
								: { url: 'https://audio.test/trip', quality: '320k' }
						},
					},
				},
			})
			h.hooks.download = async ({ fileUri }) => {
				await write(pathFromUri(fileUri), 'audio bytes')
				return { uri: fileUri, status: 200, headers: {} }
			}
			const manager = h.load('src/player/DownloadManager.ts'),
				track = song('active-trip')
			const stop = manager.startDownloadNetworkPolicy()
			const waitUntil = async (predicate) => {
				for (let i = 0; i < 200; i++) {
					if (predicate()) return
					await new Promise((resolve) => setTimeout(resolve, 5))
				}
				throw Error('Task did not settle')
			}
			try {
				await manager.enqueueDownload(track, { quality: '320k', strictQuality: true })
				await waitUntil(() => requested === 1)
				await manager.enqueueDownload(track, {
					quality: '320k',
					strictQuality: true,
					wifiOnly: true,
				})
				await waitUntil(
					() => h.stores.cacheDownloadTasksStore.getValue()[0].status === 'waiting-network',
				)
				assert.equal(h.stores.cacheDownloadTasksStore.getValue()[0].wifiOnly, true)
				gate.resolve({ url: 'https://audio.test/late', quality: '320k' })
				await flush()
				assert.equal(h.calls.downloads.length, 0)
				manager.restoreDownloadTasks()
				assert.equal(h.stores.cacheDownloadTasksStore.getValue()[0].wifiOnly, true)
				network = { type: 'wifi' }
				networkListeners.forEach((listener) => listener(network))
				await waitUntil(() => h.stores.cacheDownloadTasksStore.getValue()[0].status === 'completed')
				assert.equal(h.calls.downloads.length, 1)
			} finally {
				gate.resolve({ url: 'https://audio.test/late', quality: '320k' })
				stop()
			}
		},
	)
	await check(
		'personal tags, scenes, smart shuffle and widget selection round-trip only when settings restoration is enabled',
		() => {
			const h = fixture.runtime(),
				owner = h.load('src/helpers/musicBackup.ts')
			const scenes = data.defaultScenes('Commute', 'Sleep'),
				tags = { [data.personalTrackKey(song('tagged'))]: ['粤语'] }
			h.persistence.set('music.listeningScenes', scenes)
			h.persistence.set('music.trackTags', tags)
			h.persistence.set('music.smartShuffle', true)
			h.persistence.set('widget.collectionId', 'favorites')
			const backup = owner.createMusicBackup('test')
			assert.equal(backup.settings['music.listeningScenes'].length, 2)
			assert.equal(backup.settings['music.smartShuffle'], true)
			h.persistence.set('music.listeningScenes', [])
			h.persistence.set('music.trackTags', {})
			owner.restoreMusicBackup(backup, 'merge', false)
			assert.equal(h.persistence.get('music.listeningScenes').length, 0)
			owner.restoreMusicBackup(backup, 'merge', true)
			assert.equal(h.persistence.get('music.listeningScenes').length, 2)
			assert.equal(
				h.persistence.get('music.trackTags')[data.personalTrackKey(song('tagged'))][0],
				'粤语',
			)
			assert.throws(
				() =>
					owner.parseMusicBackup(
						JSON.stringify({
							...backup,
							settings: { 'music.listeningScenes': [{ ...scenes[0], sleepMinutes: -1 }] },
						}),
					),
				/Invalid backup setting/,
			)
			assert.throws(
				() =>
					owner.parseMusicBackup(
						JSON.stringify({ ...backup, settings: { 'music.trackTags': { bad: ['x'] } } }),
					),
				/Invalid backup setting/,
			)
		},
	)
} finally {
	await fixture.dispose()
}
await check(
	'Xcode embeds and depends on the widget target, compiles its Swift source and retains AppIntents entities',
	async () => {
		const project = require('xcode').project(
			new URL('../ios/CyMusic.xcodeproj/project.pbxproj', import.meta.url).pathname,
		)
		project.parseSync()
		const objects = project.hash.project.objects,
			targets = Object.entries(objects.PBXNativeTarget)
		const widget = targets.find(([, target]) => target.name === '"ZhMusicWidget"'),
			host = objects.PBXNativeTarget['13B07F861A680F5B00A75B9A']
		assert.ok(widget)
		assert.ok(
			host.dependencies.some((dep) => objects.PBXTargetDependency[dep.value]?.target === widget[0]),
		)
		const embedded = host.buildPhases.flatMap(
			(phase) => objects.PBXCopyFilesBuildPhase?.[phase.value]?.files ?? [],
		)
		assert.ok(
			embedded.some(
				(file) => objects.PBXBuildFile[file.value]?.fileRef === widget[1].productReference,
			),
		)
		const sources = widget[1].buildPhases.flatMap(
			(phase) => objects.PBXSourcesBuildPhase?.[phase.value]?.files ?? [],
		)
		assert.ok(
			sources.some((file) =>
				objects.PBXFileReference[objects.PBXBuildFile[file.value].fileRef].path.includes(
					'ZhMusicWidget.swift',
				),
			),
		)
		const config = objects.XCConfigurationList[widget[1].buildConfigurationList]
		assert.ok(
			config.buildConfigurations.every(
				(item) =>
					objects.XCBuildConfiguration[item.value].buildSettings.CODE_SIGN_ENTITLEMENTS ===
					'ZhMusicWidget/ZhMusicWidget.entitlements',
			),
		)
		const registration = JSON.parse(
			await fs.readFile(
				new URL('../modules/cymusic-native/expo-module.config.json', import.meta.url),
				'utf8',
			),
		)
		assert.ok(registration.apple.modules.includes('CyMusicPersonalWidgetModule'))
		const workflow = await fs.readFile(
			new URL('../.github/workflows/build-ios.yml', import.meta.url),
			'utf8',
		)
		assert.ok(workflow.includes('PlugIns/ZhMusicWidget.appex'))
	},
)
finish()
