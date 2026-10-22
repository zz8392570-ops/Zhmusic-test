import fs from 'node:fs/promises'
import { assert, checks } from './native-services-fixture.mjs'
import { createFixture, item, pathFromUri, write } from './file-system-fixture.mjs'
const { check, finish } = checks()
const fixture = createFixture()
const song = (id, extra = {}) =>
	item(id, 'Unknown', {
		platform: 'tx',
		title: 'Same recording',
		artist: 'Singer',
		duration: 180,
		...extra,
	})
function runtime() {
	const network = []
	const h = fixture.runtime({
		realCache: true,
		moduleOverrides: {
			'@/helpers/userApi/musicApiControl': {
				getFailedApiIds: () => new Set(),
				getMusicFailureKey: (track) => track.id,
				rememberFailedApi() {},
				clearFailedApis() {},
				recordMusicApiAttempt() {},
				requestMusicUrlFromApi: async (...args) => {
					network.push(args)
					throw Error('offline')
				},
				setMusicApiAsSelectedById: async () => {
					throw Error('must not switch sources')
				},
			},
		},
	})
	h.hooks.download = async ({ fileUri }) => {
		await write(pathFromUri(fileUri), 'real dedicated fixture audio')
		return { uri: fileUri, status: 200, headers: {} }
	}
	h.stores.musicApiStore.setValue([])
	h.stores.musicApiSelectedStore.setValue(null)
	return {
		...h,
		cache: h.load('src/player/CacheManager.ts'),
		resolver: h.load('src/player/MusicSourceResolver.ts'),
		network,
	}
}
try {
	await check(
		'favorite cache badge and offline playback agree when only another selected-quality file exists',
		async () => {
			const h = runtime(),
				track = song('other-quality')
			const path = await h.cache.downloadToCache(
				{ ...track, url: 'https://audio.test/a' },
				'320k',
				undefined,
				undefined,
				true,
				true,
			)
			h.stores.qualityStore.setValue('128k')
			assert.equal(await h.cache.getCachedQuality(track), '320k')
			assert.equal(await h.cache.isCached(track), true)
			const resolved = await h.resolver.resolveSource(track)
			assert.equal(resolved.wasCached, true)
			assert.equal(resolved.url, path)
			assert.equal(resolved.quality, '320k')
			assert.equal(h.network.length, 0)
		},
	)
	await check(
		'a favorite reuses another platform cache before any online source request',
		async () => {
			const h = runtime(),
				a = song('cached-platform'),
				b = song('preferred-platform', { platform: 'wy' })
			const group = h.load('src/helpers/favoriteGroups.ts').mergeFavoriteGroup([b, a])
			h.persistence.set('music.favorites', [group])
			const path = await h.cache.downloadToCache(
				{ ...a, url: 'https://audio.test/b' },
				'flac',
				undefined,
				undefined,
				true,
				true,
			)
			h.stores.importedLocalMusicStore.setValue([
				{
					...a,
					id: 'cache:tx:cached-platform:flac',
					originalId: a.id,
					url: path,
					cachedQuality: 'flac',
					cacheKind: 'saved',
				},
			])
			const resolved = await h.resolver.resolveSource(group)
			assert.equal(resolved.wasCached, true)
			assert.equal(resolved.url, path)
			assert.equal(h.network.length, 0)
		},
	)

	await check(
		'registered original IDs recover renamed and stale favorite references without networking',
		async () => {
			const h = runtime(),
				original = song('stable-original', { title: 'Old title' })
			const path = await h.cache.downloadToCache(
				{ ...original, url: 'https://audio.test/original' },
				'128k',
				undefined,
				undefined,
				true,
				true,
			)
			h.stores.importedLocalMusicStore.setValue([
				{
					...original,
					id: 'cache-alias',
					originalId: original.id,
					url: path,
					cachedQuality: '128k',
				},
			])
			const renamed = {
				...original,
				title: 'New title',
				artist: 'New artist',
				url: `file://${fixture.documents}/musicCache/removed-old-name.mp3`,
			}
			const resolved = await h.resolver.resolveSource(renamed)
			assert.equal(resolved.wasCached, true)
			assert.equal(resolved.url, path)
			assert.equal(h.network.length, 0)
			await fs.unlink(pathFromUri(h.cache.getCacheFileUri(path)))
			assert.equal(await h.cache.getCachedQuality(renamed), null)
		},
	)
	await check(
		'cache reuse rejects Live, mismatched duration, manual splits and unrelated local imports',
		async () => {
			for (const extra of [
				{ album: 'Live concert' },
				{ duration: 240 },
				{ favoriteKeepSeparate: true },
				{ platform: 'local' },
			]) {
				const h = runtime(),
					requested = song('wanted', { platform: 'wy' }),
					cached = song(`excluded-${Object.keys(extra)[0]}`, extra)
				const path = await h.cache.downloadToCache(
					{ ...cached, url: 'https://audio.test/excluded' },
					'flac',
					undefined,
					undefined,
					true,
					true,
				)
				h.stores.importedLocalMusicStore.setValue([{ ...cached, url: path, cachedQuality: 'flac' }])
				assert.equal(await h.cache.getPlaybackCachedAudioInfo(requested), null)
			}
		},
	)
	await check(
		'a cached alternate platform wins before a preferred online provider or preloaded URL',
		async () => {
			const h = runtime(),
				preferred = song('online-primary', { platform: 'wy', url: 'https://audio.test/preloaded' }),
				alternate = song('owned-alternate')
			await h.resolver.preloadSource(preferred)
			assert.equal(h.resolver.getPreloadedUrl(preferred), preferred.url)
			const path = await h.cache.downloadToCache(
				{ ...alternate, url: 'https://audio.test/owned' },
				'320k',
				undefined,
				undefined,
				true,
				true,
			)
			h.stores.importedLocalMusicStore.setValue([
				{ ...alternate, url: path, cachedQuality: '320k' },
			])
			h.stores.musicApiStore.setValue([{ id: 'online', name: 'Unavailable online' }])
			h.stores.musicApiSelectedStore.setValue({ id: 'online', name: 'Unavailable online' })
			const resolved = await h.resolver.resolveSource(preferred)
			assert.equal(resolved.wasCached, true)
			assert.equal(resolved.url, path)
			assert.equal(h.network.length, 0)
			assert.equal(h.resolver.getPreloadedUrl(preferred), undefined)
		},
	)
	await check(
		'cross-platform cache lookup reaches the real player without replacing its favorite queue slot',
		async () => {
			const h = runtime(),
				preferred = song('favorite-player', { platform: 'wy' }),
				other = song('cached-player')
			const group = h.load('src/helpers/favoriteGroups.ts').mergeFavoriteGroup([preferred, other])
			h.persistence.set('music.favorites', [group])
			const path = await h.cache.downloadToCache(
				{ ...other, url: 'https://audio.test/player' },
				'flac',
				undefined,
				undefined,
				true,
				true,
			)
			h.stores.importedLocalMusicStore.setValue([{ ...other, url: path, cachedQuality: 'flac' }])
			const player = h.load('src/helpers/trackPlayerIndex.ts').default
			await player.playWithReplacePlayList(group, [group, song('next-song')])
			assert.equal(h.stores.playbackCachedStore.getValue(), true, JSON.stringify(h.calls.errors))
			assert.equal(h.stores.playbackQualityStore.getValue(), 'flac')
			assert.equal(player.getCurrentMusic().id, preferred.id)
			assert.equal(player.getCurrentMusic().url, h.cache.getCacheFileUri(path))
			assert.deepEqual(
				Array.from(player.getPlayList(), (track) => track.id),
				[preferred.id, 'next-song'],
			)
			assert.equal(h.network.length, 0)
		},
	)
} finally {
	await fixture.dispose()
}
finish()
