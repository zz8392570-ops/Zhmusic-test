import fs from 'node:fs/promises'
import { assert, checks, deferred, flush, loadModule } from './native-services-fixture.mjs'
import { createFixture, item, write, pathFromUri } from './file-system-fixture.mjs'
const { check, finish } = checks()
const fixture = createFixture()
const song = (id, extra = {}) =>
	item(id, 'Unknown', { platform: 'tx', title: id, artist: 'Singer', ...extra })
const scene = (id, name = id) => ({
	id,
	name,
	collectionId: 'favorites',
	shuffle: false,
	offlineOnly: false,
	sleepMinutes: 0,
})
try {
	await check(
		'merge preserves new personal data, unions tags, keeps conflict choices and can undo the import exactly',
		() => {
			const h = fixture.runtime(),
				owner = h.load('src/helpers/musicBackup.ts')
			const key = JSON.stringify(['tx', 'same'])
			h.persistence.set('music.trackTags', { [key]: ['Old'] })
			h.persistence.set('music.listeningScenes', [scene('same', 'Old scene'), scene('incoming')])
			h.persistence.set('lyric.trackOffsets', { [key]: 1 })
			h.persistence.set('music.quality', '128k')
			const backup = owner.createMusicBackup('fixture')
			h.persistence.set('music.trackTags', { [key]: ['New'], '["tx","new"]': ['Keep'] })
			h.persistence.set('music.listeningScenes', [scene('same', 'My scene'), scene('new')])
			h.persistence.set('lyric.trackOffsets', { [key]: 2 })
			h.persistence.set('music.quality', 'flac')
			const before = JSON.stringify(owner.createMusicBackup('').settings)
			owner.restoreMusicBackup(backup, 'merge', true)
			assert.deepEqual(h.persistence.get('music.trackTags')[key], ['New', 'Old'])
			assert.deepEqual(h.persistence.get('music.trackTags')['["tx","new"]'], ['Keep'])
			assert.equal(h.persistence.get('music.listeningScenes')[0].name, 'My scene')
			assert.equal(h.persistence.get('music.listeningScenes').length, 3)
			assert.equal(h.persistence.get('lyric.trackOffsets')[key], 2)
			assert.equal(h.persistence.get('music.quality'), '128k')
			owner.restoreBackupCheckpoint()
			assert.equal(JSON.stringify(owner.createMusicBackup('').settings), before)
		},
	)
	await check(
		'failed recovery-point writes and merge limits leave library and settings untouched',
		() => {
			const h = fixture.runtime(),
				owner = h.load('src/helpers/musicBackup.ts')
			const backup = owner.createMusicBackup('fixture')
			backup.library.favorites = [song('incoming')]
			h.persistence.set('music.favorites', [song('current')])
			const set = h.persistence.set
			h.persistence.set = (key, value) => {
				if (key === 'backup.restorePoint') throw Error('disk full')
				set(key, value)
			}
			assert.throws(() => owner.restoreMusicBackup(backup, 'replace', true), /disk full/)
			assert.equal(h.persistence.get('music.favorites')[0].id, 'current')
			h.persistence.set = set
			h.persistence.set(
				'music.listeningScenes',
				Array.from({ length: 20 }, (_, i) => scene(`current${i}`)),
			)
			backup.settings['music.listeningScenes'] = [scene('extra')]
			assert.throws(() => owner.restoreMusicBackup(backup, 'merge', true), /limits/)
			assert.equal(h.persistence.get('music.favorites')[0].id, 'current')
			assert.equal(h.persistence.get('backup.restorePoint'), null)
		},
	)
	await check(
		'undo removes newly introduced settings and partial import failure rolls back every prior value',
		() => {
			const h = fixture.runtime(),
				owner = h.load('src/helpers/musicBackup.ts')
			const backup = owner.createMusicBackup('fixture')
			backup.settings['music.offlinePlayback'] = true
			owner.restoreMusicBackup(backup, 'merge', true)
			owner.restoreBackupCheckpoint()
			assert.equal(h.persistence.get('music.offlinePlayback'), null)
			h.persistence.set('music.favorites', [song('keep')])
			const set = h.persistence.set
			let once = true
			h.persistence.set = (key, value) => {
				if (key === 'music.playLists' && once) {
					once = false
					throw Error('failed write')
				}
				set(key, value)
			}
			assert.throws(() => owner.restoreMusicBackup(backup, 'replace', true), /failed write/)
			assert.equal(h.persistence.get('music.favorites')[0].id, 'keep')
			assert.equal(h.persistence.get('music.offlinePlayback'), null)
		},
	)
	await check(
		'metadata accounting counts real files and cleanup preserves retained assets and all audio',
		async () => {
			const h = fixture.runtime({ realCache: true }),
				assets = h.load('src/helpers/offlineAssets.ts')
			const retained = song('retained'),
				ordinary = song('ordinary')
			await assets.saveOfflineLyric(retained, { rawLrc: '[00:01] retained' })
			await assets.saveOfflineLyric(ordinary, { rawLrc: '[00:01] ordinary' })
			assets.retainOfflineAssets(retained)
			const audio = `${fixture.documents}/musicCache/keep.mp3`
			await write(audio, 'audio bytes')
			const usage = await assets.getOfflineAssetUsage()
			assert.ok(usage.lyric > usage.protected && usage.protected > 0)
			assert.equal(usage.total, usage.lyric)
			await assets.clearOfflineAssets()
			assert.ok(await assets.readOfflineLyric(retained))
			assert.equal(await assets.readOfflineLyric(ordinary), null)
			assert.equal(await fs.readFile(audio, 'utf8'), 'audio bytes')
			assets.releaseOfflineAssets([retained])
			await assets.clearOfflineAssets()
			assert.equal((await assets.getOfflineAssetUsage()).total, 0)
		},
	)
	await check(
		'batch tags retain old labels and renamed tags keep dynamic filters working for future songs',
		() => {
			const h = fixture.runtime(),
				actions = h.load('src/helpers/personalTagActions.ts'),
				data = h.load('src/helpers/personalFeatures.ts'),
				edits = h.load('src/helpers/libraryEdits.ts')
			const a = song('a'),
				b = song('b')
			h.persistence.set('music.favorites', [a, b])
			h.persistence.set('music.trackTags', { [data.personalTrackKey(a)]: ['Original'] })
			assert.equal(
				actions.tagSelectedSongs(
					new Set([edits.getLibraryTrackKey(a), edits.getLibraryTrackKey(b)]),
					[' Trip '],
				),
				2,
			)
			const collection = actions.saveTagCollection('Driving', ['Trip'], true)
			actions.renameLibraryTag('trip', 'Commute')
			assert.deepEqual(h.persistence.get('music.trackTags')[data.personalTrackKey(a)], [
				'Original',
				'Commute',
			])
			assert.deepEqual(h.persistence.get('music.tagCollections')[0].tags, ['Commute'])
			const newSong = song('c')
			h.persistence.set('music.favorites', [a, b, newSong])
			actions.tagSelectedSongs(new Set([edits.getLibraryTrackKey(newSong)]), ['Commute'])
			const all = data.personalTracks(h.persistence.get('music.favorites'), [], [])
			assert.equal(
				data.filterTaggedTracks(
					all,
					h.persistence.get('music.trackTags'),
					all,
					h.persistence.get('music.tagCollections')[0].tags,
					collection.matchAll,
				).length,
				3,
			)
			assert.throws(() => actions.tagSelectedSongs(new Set(['removed']), ['Trip']), /No selection/)
		},
	)
	await check(
		'offline playback rejects remote and missing audio without a source call but allows a verified local copy',
		async () => {
			let requests = 0
			const h = fixture.runtime({
				realCache: true,
				moduleOverrides: {
					'@/helpers/userApi/musicApiControl': {
						getFailedApiIds: () => new Set(),
						getMusicFailureKey: (track) => track.id,
						requestMusicUrlFromApi: async () => {
							requests++
							throw Error('unexpected network')
						},
					},
				},
			})
			h.persistence.set('music.offlinePlayback', true)
			const resolver = h.load('src/player/MusicSourceResolver.ts')
			for (const track of [song('missing'), song('direct', { url: 'https://audio.test/file' })])
				await assert.rejects(
					resolver.resolveSource(track),
					(error) => error.name === 'OfflineAudioUnavailable',
				)
			const file = `${fixture.documents}/download/music/local.mp3`
			await write(file, 'local audio')
			const result = await resolver.resolveSource(
				song('local', { platform: 'local', url: `file://${file}` }),
			)
			assert.equal(result.url, `file://${file}`)
			await resolver.preloadSource(song('prefetch'))
			assert.equal(requests, 0)
		},
	)
	await check(
		'offline lyric loading uses saved metadata and an in-flight request cannot persist after mode changes',
		async () => {
			const h = fixture.runtime({ realCache: true }),
				assets = h.load('src/helpers/offlineAssets.ts')
			h.persistence.set('music.offlinePlayback', true)
			assert.equal(
				(
					await assets.getPreparedLyric(song('missing-lyric'), () => {
						throw Error('network')
					})
				).rawLrc,
				'',
			)
			h.persistence.set('music.offlinePlayback', false)
			const gate = deferred(),
				started = deferred()
			let signal
			const pending = assets.getPreparedLyric(song('late-lyric'), async (_track, owner) => {
				signal = owner
				started.resolve()
				return gate.promise
			})
			await started.promise
			h.persistence.set('music.offlinePlayback', true)
			assert.equal(signal.aborted, true)
			gate.resolve({ rawLrc: '[00:01] should not save' })
			assert.equal((await pending).rawLrc, '')
			assert.equal(await assets.readOfflineLyric(song('late-lyric')), null)
		},
	)
	await check(
		'offline mode pauses queued downloads and changing it back resumes without losing the task',
		async () => {
			let listener
			const h = fixture.runtime({
				realCache: true,
				moduleOverrides: {
					'expo-network': {
						NetworkStateType: { WIFI: 'wifi', ETHERNET: 'ethernet', NONE: 'none' },
						getNetworkStateAsync: async () => ({ type: 'wifi' }),
						addNetworkStateListener: (fn) => {
							listener = fn
							return { remove() {} }
						},
					},
					'@/player/MusicSourceResolver': {
						resolveSource: async () => ({ url: 'https://audio.test/file', quality: '320k' }),
					},
				},
			})
			h.persistence.set('music.offlinePlayback', true)
			h.hooks.download = async ({ fileUri }) => {
				await write(pathFromUri(fileUri), 'downloaded')
				return { uri: fileUri, status: 200, headers: {} }
			}
			const manager = h.load('src/player/DownloadManager.ts'),
				stop = manager.startDownloadNetworkPolicy()
			const wait = async (status) => {
				for (let i = 0; i < 100; i++) {
					if (h.stores.cacheDownloadTasksStore.getValue()[0]?.status === status) return
					await new Promise((resolve) => setTimeout(resolve, 5))
				}
				assert.fail(`did not reach ${status}`)
			}
			try {
				await manager.enqueueDownload(song('offline-download'), { quality: '320k', wifiOnly: true })
				await wait('waiting-network')
				assert.equal(h.calls.downloads.length, 0)
				h.persistence.set('music.offlinePlayback', false)
				listener({ type: 'wifi' })
				await wait('completed')
				assert.equal(h.calls.downloads.length, 1)
			} finally {
				stop()
			}
		},
	)
	await check(
		'one-tap preparation rechecks approved songs, queues only remaining audio, refreshes results and respects cancellation',
		async () => {
			const h = fixture.runtime(),
				data = h.load('src/helpers/personalFeatures.ts')
			const a = song('needs-audio'),
				b = song('already-ready'),
				unknown = song('unknown'),
				added = song('added-after-approval')
			let current = [a, b, unknown, added],
				queued = [],
				metadataCalls = 0,
				scans = 0
			const owner = loadModule('src/helpers/travelPackActions.ts', {
				'@/store/PersistStatus': h.persistence,
				'@/player/DownloadManager': {
					enqueueDownload: async (track, options) => {
						queued.push({ track, options })
					},
				},
				'./personalFeatures': data,
				'./travelPreparation': {
					inspectTravelCollection: async (tracks) => {
						scans++
						return tracks.map((track) => ({
							track,
							audio: track.id === b.id || scans > 1,
							lyric: true,
							artwork: true,
							unknown: track.id === unknown.id,
						}))
					},
					prepareTravelMetadata: async () => {
						metadataCalls++
						return { done: 4, failed: 0 }
					},
				},
			})
			const approved = new Set([a, b, unknown].map(data.personalTrackKey))
			const result = await owner.prepareTravelPack(
				() => current,
				approved,
				'flac',
				new AbortController().signal,
				() => {},
			)
			assert.equal(queued.length, 1)
			assert.equal(queued[0].track.id, a.id)
			assert.equal(queued[0].options.wifiOnly, true)
			assert.equal(queued[0].options.strictQuality, true)
			assert.equal(queued[0].options.quality, 'flac')
			assert.ok(result.entries.every((entry) => entry.audio))
			assert.equal(scans, 2)
			const cancelled = new AbortController()
			cancelled.abort()
			assert.equal(
				await owner.prepareTravelPack(
					() => current,
					approved,
					'320k',
					cancelled.signal,
					() => {},
				),
				null,
			)
			assert.equal(metadataCalls, 1)
			current = null
			assert.equal(
				await owner.prepareTravelPack(
					() => current,
					approved,
					'320k',
					new AbortController().signal,
					() => {},
				),
				null,
			)
		},
	)
	await check(
		'dynamic scene collections resolve current tags and pinned scene counts are bounded',
		() => {
			const h = fixture.runtime(),
				data = h.load('src/helpers/personalFeatures.ts')
			const a = song('tagged'),
				b = song('later')
			h.persistence.set('music.favorites', [a, b])
			h.persistence.set('music.trackTags', { [data.personalTrackKey(a)]: ['Trip'] })
			h.persistence.set('music.tagCollections', [
				{ id: 'tags:trip', name: 'Trip', tags: ['Trip'], matchAll: true },
			])
			const owner = loadModule('src/helpers/listeningSceneActions.ts', {
				'@/store/PersistStatus': h.persistence,
				'./personalFeatures': data,
				'./trackPlayerIndex': {},
				'./playlistOffline': {},
				'@/utils/timingClose': {},
				'@/utils/i18n': { t: (key) => key },
			})
			assert.equal(owner.getListeningCollection('tags:trip').length, 1)
			h.persistence.set('music.trackTags', {
				[data.personalTrackKey(a)]: ['Trip'],
				[data.personalTrackKey(b)]: ['Trip'],
			})
			assert.equal(owner.getListeningCollection('tags:trip').length, 2)
			assert.equal(
				data.isValidScenes(
					Array.from({ length: 6 }, (_, i) => ({ ...scene(String(i)), pinned: true })),
				),
				true,
			)
			assert.equal(
				data.isValidScenes(
					Array.from({ length: 7 }, (_, i) => ({ ...scene(String(i)), pinned: true })),
				),
				false,
			)
		},
	)

	await flush()
} finally {
	await fixture.dispose()
}
finish()
