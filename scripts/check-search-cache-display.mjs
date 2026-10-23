import fs from 'node:fs/promises'
import { assert, checks, deferred, flush, loadModule } from './native-services-fixture.mjs'
import { createFixture, item, pathFromUri, write } from './file-system-fixture.mjs'

const suite = checks()
const fixture = createFixture()
const makeLookup = (query, options = {}) => {
	const h = fixture.runtime({ realCache: true })
	const cache = h.load('src/player/CacheManager.ts')
	const { createCacheDisplayLookup } = loadModule('src/helpers/cacheDisplayLookup.ts', {
		'@/player/CacheManager': cache,
		'@/player/PlayerStore': h.stores,
	})
	const lookup = createCacheDisplayLookup({
		query,
		probeKey: cache.getCacheDisplayProbeKey,
		contextKey: () =>
			JSON.stringify([h.stores.cacheRevisionStore.getValue(), h.stores.qualityStore.getValue()]),
		...options,
	})
	return { h, cache, lookup }
}
const song = (id, extra = {}) => item(id, 'Unknown', extra)

try {
	await suite.check('row and search share the same in-flight cache lookup', async () => {
		const gate = deferred()
		let calls = 0
		const { lookup } = makeLookup(async () => {
			calls++
			return gate.promise
		})
		const track = song('shared')
		const row = lookup.get(track)
		assert.equal(lookup.get({ ...track }), row)
		const scan = lookup.scan([track])
		await flush()
		assert.equal(calls, 1)
		gate.resolve('flac')
		assert.equal((await row).quality, 'flac')
		assert.ok((await scan).keys.has(lookup.trackKey(track)))
		assert.equal(calls, 1)
	})
	await suite.check(
		'identity, URI, metadata, quality, revision and actual named paths do not collide',
		async () => {
			let calls = 0
			const { h, lookup } = makeLookup(async () => {
				calls++
				return null
			})
			const original = song('identity')
			await lookup.get(original)
			for (const extra of [
				{ id: 'other' },
				{ platform: 'wy' },
				{ title: 'Renamed' },
				{ artist: 'Other artist' },
				{ url: 'file:///some/other/musicCache/offline.flac' },
				{ cachedQuality: 'flac' },
			])
				await lookup.get({ ...original, ...extra })
			assert.equal(calls, 7)
			h.stores.qualityStore.setValue('320k')
			await lookup.get(original)
			h.stores.cacheRevisionStore.setValue(1)
			await lookup.get(original)
			h.persistence.set('music.downloadFilenameMap', {
				[JSON.stringify([original.platform, original.id, 'mp3'])]: 'New actual file.mp3',
			})
			await lookup.get(original)
			assert.equal(calls, 10)
		},
	)
	await suite.check(
		'scans have bounded I/O and appending a page probes only new candidates',
		async () => {
			let active = 0,
				peak = 0,
				calls = 0
			const { lookup } = makeLookup(
				async () => {
					calls++
					active++
					peak = Math.max(peak, active)
					await Promise.resolve()
					await Promise.resolve()
					active--
					return '320k'
				},
				{ concurrency: 2 },
			)
			const tracks = Array.from({ length: 12 }, (_, index) => song(`bounded-${index}`))
			assert.equal((await lookup.scan(tracks)).keys.size, 12)
			assert.equal(peak, 2)
			assert.equal(calls, 12)
			assert.equal((await lookup.scan([...tracks, song('new-page')])).keys.size, 13)
			assert.equal(calls, 13)
		},
	)
	await suite.check(
		'one failing source leaves other matches visible and can be retried',
		async () => {
			let failed = true,
				failedCalls = 0
			const { lookup } = makeLookup(async (track) => {
				if (track.id === 'bad') {
					failedCalls++
					if (failed) throw new Error('File service unavailable')
				}
				return track.id === 'main' ? null : 'flac'
			})
			const bad = song('bad'),
				good = song('good')
			const alternative = song('main', {
				sourceAlternatives: [song('alternative', { platform: 'wy' })],
			})
			const scan = await lookup.scan([bad, good, alternative])
			assert.equal(scan.hasErrors, true)
			assert.equal(scan.keys.size, 2)
			assert.ok(scan.keys.has(lookup.trackKey(good)))
			assert.ok(scan.keys.has(lookup.trackKey(alternative)))
			assert.equal(lookup.peek(bad), undefined)
			failed = false
			assert.equal((await lookup.get(bad)).quality, 'flac')
			assert.equal(failedCalls, 2)
		},
	)
	await suite.check(
		'cache clearing discards old results, skips queued old probes and publishes no old scan',
		async () => {
			const gate = deferred()
			let calls = 0,
				published = 0
			const { h, lookup } = makeLookup(
				async () => {
					calls++
					return calls === 1 ? gate.promise : null
				},
				{ concurrency: 1 },
			)
			const first = song('old-revision'),
				queued = song('queued-old-revision')
			const old = lookup.get(first)
			const waiting = lookup.get(queued)
			const scan = lookup.scan([first], { onProgress: () => published++ })
			await flush()
			h.stores.cacheRevisionStore.setValue(1)
			const fresh = lookup.get(first)
			gate.resolve('flac')
			assert.equal((await old).status, 'stale')
			assert.equal((await waiting).status, 'stale')
			await scan
			assert.equal(published, 0)
			assert.equal((await fresh).quality, null)
			assert.equal(lookup.peek(first).quality, null)
			assert.equal(calls, 2)
		},
	)
	await suite.check(
		'switching search ownership cancels the old scan before late matches are published',
		async () => {
			const gate = deferred()
			let cancelled = false,
				published = 0,
				calls = 0
			const { lookup } = makeLookup(
				async () => {
					calls++
					return gate.promise
				},
				{ concurrency: 2 },
			)
			const scan = lookup.scan(
				Array.from({ length: 8 }, (_, index) => song(`cancelled-${index}`)),
				{
					isCancelled: () => cancelled,
					onProgress: () => published++,
				},
			)
			await flush()
			cancelled = true
			gate.resolve('flac')
			await scan
			assert.equal(published, 0)
			assert.equal(calls, 2)
		},
	)
	await suite.check('display results expire instead of growing without a bound', async () => {
		let now = 0,
			calls = 0
		const { lookup } = makeLookup(
			async () => {
				calls++
				return null
			},
			{ maxEntries: 2, ttlMs: 10, now: () => now },
		)
		const first = song('expiry-first')
		await lookup.get(first)
		now = 11
		await lookup.get(first)
		assert.equal(calls, 2)
		await lookup.get(song('expiry-second'))
		await lookup.get(song('expiry-third'))
		assert.equal(lookup.peek(first), undefined)
	})
	await suite.check(
		'display memoization never bypasses live playback checks or trusts deleted cachedQuality',
		async () => {
			const h = fixture.runtime({ realCache: true })
			const cache = h.load('src/player/CacheManager.ts')
			const { cacheDisplayLookup: lookup } = h.load('src/helpers/cacheDisplayLookup.ts')
			const track = song('real-offline', { cachedQuality: 'flac' })
			const filePath = pathFromUri(cache.getCacheFileUri(cache.getLocalFilePath(track, 'flac')))
			await write(filePath, 'Audio bytes')
			assert.equal((await lookup.get(track)).quality, 'flac')
			await fs.unlink(filePath)
			assert.equal(await cache.getCachedAudioInfo(track, true), null)
			h.stores.cacheRevisionStore.setValue(1)
			assert.equal(lookup.peek(track), undefined)
			assert.equal((await lookup.get(track)).quality, null)
		},
	)
	const { getSearchEmptyState } = loadModule('src/helpers/searchResultState.ts', {})
	await suite.check(
		'loaded results hidden by filters are distinct from empty searches and cache checks',
		() => {
			const base = { isLoading: false, hasError: false, isFiltered: true, unfilteredCount: 12 }
			assert.equal(getSearchEmptyState(base), 'filteredEmpty')
			assert.equal(getSearchEmptyState({ ...base, isCacheLoading: true }), 'checkingCache')
			assert.equal(getSearchEmptyState({ ...base, hasCacheError: true }), 'cacheError')
			assert.equal(getSearchEmptyState({ ...base, unfilteredCount: 0 }), 'empty')
			assert.equal(
				getSearchEmptyState({ ...base, unfilteredCount: 0, hasError: true }),
				'searchError',
			)
			assert.equal(getSearchEmptyState({ ...base, isLoading: true }), 'searching')
			assert.equal(getSearchEmptyState({ ...base, hasError: true }), 'searchError')
		},
	)

	const react = {
		memo: (component) => component,
		useMemo: (compute) => compute(),
		useCallback: (callback) => callback,
		useState: (value) => [value, () => {}],
		createElement: (type, props, ...children) => ({
			type,
			props: { ...props, children: children.flat().filter(Boolean) },
		}),
	}
	const { SearchList } = loadModule(
		'src/components/SearchList.tsx',
		{
			react,
			'@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
			'@rntp/player': { useIsPlaying: () => false },
			'@shopify/flash-list': { FlashList: 'FlashList' },
			'expo-image': { Image: 'Image' },
			'expo-router': { router: { navigate() {} } },
			'react-native': {
				View: 'View',
				Text: 'Text',
				Pressable: 'Pressable',
				TouchableOpacity: 'TouchableOpacity',
				ActivityIndicator: 'Spinner',
				StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
			},
			'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
			'@/constants/images': {
				unknownTrackImageUri: 'fallback',
				unknownArtistImageUri: 'artist-fallback',
			},
			'@/helpers/trackPlayerIndex': { useCurrentMusic: () => null },
			'@/helpers/searchResultState': { getSearchEmptyState },
			'@/hooks/useAppTheme': { useThemeColors: () => ({ primary: 'red' }) },
			'@/styles': { useDefaultStyles: () => ({ container: {} }) },
			'@/utils/i18n': { t: (key) => key },
			'@/helpers/favoriteGroups': loadModule('src/helpers/favoriteGroups.ts', {}),
			'@/helpers/favoriteGroupActions': {},
			'@/utils/mediaItem': { isSameMediaItem: () => false },
			'./TracksListItem': 'TrackRow',
		},
		{ React: react },
	)
	const find = (node, type) =>
		!node || typeof node !== 'object'
			? []
			: [
					...(node.type === type ? [node] : []),
					...(node.props?.children ?? []).flatMap((child) => find(child, type)),
				]
	await suite.check(
		'a row drops persisted cachedQuality immediately after clearing the actual cache',
		async () => {
			const h = fixture.runtime({ realCache: true })
			const cache = h.load('src/player/CacheManager.ts')
			const { cacheDisplayLookup: lookup } = h.load('src/helpers/cacheDisplayLookup.ts')
			const track = song('row-clear', { cachedQuality: 'flac' })
			const filePath = pathFromUri(cache.getCacheFileUri(cache.getLocalFilePath(track, 'flac')))
			await write(filePath, 'Audio bytes')
			await lookup.get(track)
			const { default: TrackRow } = loadModule('src/components/TracksListItem.tsx', {
				'@/components/OfflineAvailabilityLabel': 'OfflineLabel',
				'@/components/LibraryMembershipLabel': 'MembershipLabel',
				react: { ...react, useEffect() {} },
				'@/store/library': { useFavorites: () => ({ favorites: [], toggleTrackFavorite() {} }) },
				'@/helpers/favoriteGroups': loadModule('src/helpers/favoriteGroups.ts', {}),
				'@/helpers/favoriteGroupActions': {},
				'@/utils/mediaItem': { isSameMediaItem: () => false },
				'@/components/TrackShortcutsMenu': { TrackShortcutsMenu: 'TrackMenu' },
				'@/components/AudioQualityBadge': 'QualityBadge',
				'@/constants/images': { unknownTrackImageUri: 'fallback' },
				'@/helpers/cacheDisplayLookup': { cacheDisplayLookup: lookup },
				'@/player/PlayerStore': h.stores,
				'@/helpers/trackPlayerIndex': {
					isCachedIconVisibleStore: h.stores.isCachedIconVisibleStore,
				},
				'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
				'@/styles': { useDefaultStyles: () => ({}) },
				'@/utils/imageUtils': { getThumbnailArtwork: () => 'fallback' },
				'@expo/vector-icons': { Entypo: 'Icon', Ionicons: 'Icon' },
				'react-native': {
					View: 'View',
					Text: 'Text',
					TouchableOpacity: 'TouchableOpacity',
					TouchableHighlight: 'TouchableHighlight',
					StyleSheet: { create: (styles) => styles },
				},
				'expo-image': { Image: 'Image' },
				'react-native-loader-kit': 'Loader',
				'@/utils/i18n': { t: (key) => key },
				'@/helpers/musicPlatform': { getMusicPlatformLabelKey: () => 'find.platformTx' },
				'@/helpers/leaderboard': { resolveLeaderboardArtwork: async () => undefined },
				'@/utils/haptics': { hapticLight() {}, hapticSelection() {} },
				'@/helpers/libraryEdits': { getLibraryTrackKey: () => 'key' },
			})
			const searchRow = TrackRow({ track, showLibraryStatus: true, onTrackSelect() {} })
			assert.equal(find(searchRow, 'MembershipLabel')[0].props.track, track)
			assert.equal(find(searchRow, 'OfflineLabel')[0].props.verifiedCached, true)
			assert.equal(find(TrackRow({ track, onTrackSelect() {} }), 'MembershipLabel').length, 0)
			assert.equal(
				find(TrackRow({ track, onTrackSelect() {} }), 'QualityBadge')[0].props.quality,
				'flac',
			)
			await fs.unlink(filePath)
			h.stores.cacheRevisionStore.setValue(1)
			assert.equal(
				find(TrackRow({ track, onTrackSelect() {} }), 'QualityBadge')[0].props.quality,
				null,
			)
		},
	)
	await suite.check(
		'actual search rows enable collection labels without changing playback selection',
		() => {
			const track = song('library-status')
			const tree = SearchList({
				tracks: [track],
				query: 'Song',
				isLoading: false,
				hasError: false,
				hasMore: false,
				onRetry() {},
				onLoadMore() {},
			})
			const row = find(tree, 'FlashList')[0].props.renderItem({ item: track, index: 0 })
			assert.equal(row.props.showLibraryStatus, true)
			assert.equal(row.props.track, track)
		},
	)
	await suite.check(
		'filtered-empty results expose working clear and manual next-page actions',
		() => {
			let cleared = 0,
				loaded = 0
			const tree = SearchList({
				tracks: [],
				query: 'Song',
				isLoading: false,
				hasError: false,
				hasMore: true,
				onRetry() {},
				onLoadMore: () => loaded++,
				isFiltered: true,
				unfilteredCount: 12,
				onClearFilter: () => cleared++,
			})
			const list = find(tree, 'FlashList')[0]
			const empty = list.props.ListEmptyComponent.type(list.props.ListEmptyComponent.props)
			find(empty, 'Pressable')[0].props.onPress()
			assert.equal(cleared, 1)
			list.props.onEndReached()
			assert.equal(loaded, 0)
			list.props.ListFooterComponent.props.onPress()
			assert.equal(loaded, 1)
		},
	)
} finally {
	await fixture.dispose()
}
suite.finish()
