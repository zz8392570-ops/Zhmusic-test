import { create } from 'zustand'
import { match, P } from 'ts-pattern'
import { assert, checks, loadModule } from './native-services-fixture.mjs'
const { check, finish } = checks()
const groups = loadModule('src/helpers/favoriteGroups.ts', {})
const edits = loadModule('src/helpers/libraryEdits.ts', {})
const track = (id, platform = 'tx', extra = {}) => ({
	id,
	platform,
	title: 'Song',
	artist: 'Singer',
	duration: 180,
	album: 'Album',
	artwork: '',
	url: 'Unknown',
	...extra,
})
const fixture = (initial) => {
	const disk = new Map([['music.favorites', initial]])
	let failKey
	const persist = {
		get: (key) => disk.get(key) ?? null,
		set: (key, value) => {
			if (key === failKey) {
				failKey = undefined
				throw new Error('Storage failed')
			}
			if (value === undefined) disk.delete(key)
			else disk.set(key, JSON.parse(JSON.stringify(value)))
		},
	}
	const library = loadModule('src/store/library.tsx', {
		'@/helpers/leaderboard': {},
		'@/utils/utils': { showToast() {} },
		'@/utils/i18n': { t: (key) => key },
		react: {},
		zustand: { create },
		'@/helpers/userApi/getMusicSource': {},
		'@/store/PersistStatus': persist,
		'@/helpers/favoriteGroups': groups,
	})
	const actions = loadModule('src/helpers/favoriteGroupActions.ts', {
		'@/store/PersistStatus': persist,
		'@/store/library': library,
		'./libraryEdits': edits,
		'./favoriteGroups': groups,
	})
	return {
		...actions,
		...library,
		disk,
		fail: (key) => {
			failKey = key
		},
		current: () => library.useLibraryStore.getState().favorites,
	}
}
await check(
	'conservative matching preserves complete artist sets, versions, local files and missing durations',
	() => {
		const first = track('one')
		assert.equal(groups.isSameFavoriteRecording(first, track('two', 'wy', { duration: 183 })), true)
		for (const second of [
			track('two', 'wy', { title: 'Song Live' }),
			track('two', 'wy', { title: 'Song Remix' }),
			track('two', 'wy', { artist: 'Another singer' }),
			track('two', 'wy', { artist: 'Singer、Guest' }),
			track('two', 'wy', { duration: 185 }),
			track('two', 'wy', { album: 'Live at Wembley' }),
			track('two', 'wy', { duration: 0 }),
			track('two', 'local'),
			track('two', 'tx'),
		])
			assert.equal(groups.isSameFavoriteRecording(first, second), false)
		assert.equal(
			groups.isSameFavoriteRecording(
				track('one', 'tx', { artist: 'A、B', title: 'ＡＢＣ' }),
				track('two', 'wy', { artist: 'B / A', title: 'abc' }),
			),
			true,
		)
		const chain = groups.normalizeFavoriteGroups([
			first,
			track('two', 'wy', { duration: 184 }),
			track('three', 'kg', { duration: 188 }),
		])
		assert.equal(chain.length, 2)
	},
)
await check(
	'adding another platform retains one favorite; both versions share hearts and removing either removes the group',
	() => {
		const first = track('one'),
			second = track('two', 'wy')
		const h = fixture([first])
		h.useLibraryStore.getState().toggleTrackFavorite(second)
		assert.equal(h.current().length, 1)
		assert.equal(h.current()[0].id, first.id)
		assert.equal(groups.isFavoriteTrack(h.current()[0], second), true)
		assert.equal(groups.getFavoriteVariants(h.current()[0]).length, 2)
		assert.equal(h.disk.get('music.favorites')[0].sourceAlternatives[0].platform, 'wy')
		h.useLibraryStore.getState().toggleTrackFavorite(second)
		assert.equal(h.current().length, 0)
	},
)
await check(
	'preview excludes unchecked groups; edits made during confirmation cannot be overwritten',
	() => {
		const songs = [
			track('one'),
			track('two', 'wy'),
			track('three', 'tx', { title: 'Other' }),
			track('four', 'wy', { title: 'Other' }),
			track('unknown', 'kg', { duration: 0 }),
		]
		const h = fixture(songs)
		const plan = groups.getFavoriteMergeCandidates(songs)
		assert.equal(plan.filter((item) => !item.review).length, 2)
		assert.equal(
			plan.some((item) => item.review),
			true,
		)
		const chosen = plan.find((item) => !item.review)
		assert.equal(h.mergeSelectedFavorites(songs, new Set([chosen.id])), 1)
		assert.equal(h.current().length, 4)
		assert.equal(h.undoFavoriteMerge(), true)
		assert.equal(h.current().length, songs.length)
		h.replaceFavorites(songs.filter((item) => item.id !== 'two'))
		assert.equal(h.mergeSelectedFavorites(songs, new Set([chosen.id])), 0)
		assert.equal(
			h.current().some((item) => item.id === 'two'),
			false,
		)
	},
)
await check(
	'undo preserves unrelated additions; split preserves versions and suppresses regrouping',
	() => {
		const songs = [track('one'), track('two', 'wy')]
		const h = fixture(songs)
		h.mergeSelectedFavorites(songs, new Set([groups.getFavoriteMergeCandidates(songs)[0].id]))
		const merged = h.current()[0]
		h.useLibraryStore.getState().toggleTrackFavorite(track('new', 'kg', { title: 'New' }))
		assert.equal(h.undoFavoriteMerge(), true)
		assert.deepEqual(
			Array.from(h.current(), (item) => item.id),
			['one', 'two', 'new'],
		)
		h.mergeSelectedFavorites(
			h.current(),
			new Set([groups.getFavoriteMergeCandidates(h.current())[0].id]),
		)
		h.splitFavoriteGroup(merged)
		assert.equal(h.current().length, 3)
		assert.equal(groups.getFavoriteVariants(h.current()[0]).length, 1)
		assert.equal(groups.normalizeFavoriteGroups(h.current()).length, 3)
		assert.equal(groups.getFavoriteMergeCandidates(h.current()).length, 0)
	},
)
await check(
	'undo retains unrelated removals, edits and current order across multiple groups',
	() => {
		const songs = [
			track('one'),
			track('unrelated', 'tx', { title: 'Other' }),
			track('two', 'wy'),
			track('three', 'tx', { title: 'Second' }),
			track('four', 'wy', { title: 'Second' }),
			track('removed', 'kg', { title: 'Removed' }),
		]
		const h = fixture(songs)
		h.mergeSelectedFavorites(
			songs,
			new Set(groups.getFavoriteMergeCandidates(songs).map((group) => group.id)),
		)
		const [first, unrelated, second] = h.current()
		const edited = { ...unrelated, title: 'Edited', lyric: { rawLrc: 'Keep this edit' } }
		h.replaceFavorites([second, edited, first])
		assert.equal(h.undoFavoriteMerge(), true)
		assert.deepEqual(
			h.current().map((item) => item.id),
			['three', 'four', 'unrelated', 'one', 'two'],
		)
		assert.deepEqual(h.current()[2], edited)
		assert.equal(h.undoFavoriteMerge(), false)
	},
)
await check(
	'undo refuses group edits, removal, splits and new overlapping platform entries atomically',
	() => {
		const songs = [
			track('one'),
			track('two', 'wy'),
			track('three', 'tx', { title: 'Second' }),
			track('four', 'wy', { title: 'Second' }),
		]
		for (const change of [
			(h) =>
				h.replaceFavorites(
					h.current().map((item, i) => (i === 1 ? { ...item, title: 'Changed' } : item)),
				),
			(h) => h.replaceFavorites(h.current().slice(0, 1)),
			(h) => h.splitFavoriteGroup(h.current()[1]),
			(h) => h.replaceFavorites([...h.current(), track('two', 'wy')]),
			(h) => h.preferFavoriteSource(h.current()[1], track('four', 'wy')),
		]) {
			const h = fixture(songs)
			h.mergeSelectedFavorites(
				songs,
				new Set(groups.getFavoriteMergeCandidates(songs).map((group) => group.id)),
			)
			change(h)
			const before = JSON.stringify(h.current())
			assert.equal(h.undoFavoriteMerge(), false)
			assert.equal(JSON.stringify(h.current()), before)
			assert.equal(h.disk.has('music.favoriteMergeUndo'), true)
		}
	},
)
await check(
	'scoped undo survives restart and failed writes; legacy snapshots remain compatible',
	() => {
		const songs = [track('one'), track('two', 'wy')]
		const h = fixture(songs)
		h.mergeSelectedFavorites(songs, new Set([groups.getFavoriteMergeCandidates(songs)[0].id]))
		const recovery = h.disk.get('music.favoriteMergeUndo')
		const restarted = fixture([...h.current(), track('new', 'kg', { title: 'New' })])
		restarted.disk.set('music.favoriteMergeUndo', recovery)
		restarted.fail('music.favorites')
		assert.throws(() => restarted.undoFavoriteMerge(), /Storage failed/)
		assert.deepEqual(restarted.disk.get('music.favoriteMergeUndo'), recovery)
		assert.equal(restarted.current().length, 2)
		assert.equal(restarted.undoFavoriteMerge(), true)
		assert.deepEqual(
			restarted.current().map((item) => item.id),
			['one', 'two', 'new'],
		)
		const legacy = { before: recovery.before, after: recovery.after }
		const old = fixture(recovery.after)
		old.disk.set('music.favoriteMergeUndo', legacy)
		old.replaceFavorites([...old.current(), track('new', 'kg', { title: 'New' })])
		assert.equal(old.undoFavoriteMerge(), false)
		old.replaceFavorites(recovery.after)
		assert.equal(old.undoFavoriteMerge(), true)
		assert.deepEqual(old.current(), songs)
	},
)
await check(
	'default favorite source persists, retains every platform and rejects stale choices',
	() => {
		const first = track('one', 'tx', { cachedQuality: 'flac' })
		const second = track('two', 'wy', { lyric: { rawLrc: 'saved' } })
		const h = fixture([
			groups.mergeFavoriteGroup([first, second]),
			track('other', 'kg', { title: 'Other' }),
		])
		const before = h.current()
		assert.equal(h.preferFavoriteSource(first, track('missing', 'wy')), undefined)
		assert.equal(h.current(), before)
		const preferred = h.preferFavoriteSource(first, second)
		assert.equal(preferred.platform, 'wy')
		assert.equal(h.current()[0], preferred)
		assert.deepEqual(preferred.lyric, second.lyric)
		assert.equal(preferred.sourceAlternatives[0].cachedQuality, 'flac')
		assert.equal(h.current()[1], before[1])
		const restarted = fixture(h.disk.get('music.favorites'))
		assert.equal(restarted.current()[0].platform, 'wy')
		assert.equal(
			groups.normalizeFavoriteGroups([...restarted.current(), first, second])[0].platform,
			'wy',
		)
		assert.equal(groups.getFavoriteVariants(restarted.current()[0]).length, 2)
		const saved = h.current()
		assert.equal(h.preferFavoriteSource(first, second), preferred)
		assert.equal(h.current(), saved)
		h.fail('music.favorites')
		assert.throws(() => h.preferFavoriteSource(first, first), /Storage failed/)
		assert.equal(h.current(), saved)
		h.replaceFavorites([first])
		assert.equal(h.preferFavoriteSource(first, second), undefined)
		h.replaceFavorites([])
		assert.equal(h.preferFavoriteSource(first, second), undefined)
	},
)
await check(
	'failed favorites writes publish no merge and retain the previous recovery record',
	() => {
		const songs = [track('one'), track('two', 'wy')],
			h = fixture(songs)
		h.fail('music.favorites')
		assert.throws(
			() =>
				h.mergeSelectedFavorites(songs, new Set([groups.getFavoriteMergeCandidates(songs)[0].id])),
			/Storage failed/,
		)
		assert.equal(h.current().length, 2)
		assert.equal(h.disk.has('music.favoriteMergeUndo'), false)
		h.fail('music.favorites')
		assert.throws(
			() => h.useLibraryStore.getState().toggleTrackFavorite(track('three', 'kg')),
			/Storage failed/,
		)
		assert.equal(h.current().length, 2)
	},
)
await check(
	'normalization preserves alternatives and split choices when backup/sync repeats provider records',
	() => {
		const first = track('one'),
			second = track('two', 'wy')
		const merged = groups.mergeFavoriteGroup([first, second])
		const result = groups.normalizeFavoriteGroups([merged, first, second, track('three', 'kg')])
		assert.equal(result.length, 1)
		assert.equal(groups.getFavoriteVariants(result[0]).length, 3)
		assert.equal(
			groups.normalizeFavoriteGroups([{ ...first, favoriteKeepSeparate: true }, second]).length,
			2,
		)
	},
)
await check(
	'duplicate provider IDs consume distinct rows and keep the first record metadata',
	() => {
		const first = track('one', 'tx', { lyric: { rawLrc: 'saved lyric' }, cachedQuality: 'flac' })
		const h = fixture([first, { ...first }, track('two', 'wy')])
		const plan = groups.getFavoriteMergeCandidates(h.current())[0]
		assert.equal(h.mergeSelectedFavorites(h.current(), new Set([plan.id])), 1)
		assert.equal(h.current().length, 1)
		assert.equal(h.current()[0].cachedQuality, 'flac')
		assert.equal(h.current()[0].lyric.rawLrc, 'saved lyric')
		assert.equal(groups.getFavoriteVariants(h.current()[0]).length, 2)
	},
)
await check(
	'favorite indexes are shared across consumers and rebuilt for immutable edits without rescanning rows',
	() => {
		let reads = 0
		const first = track('one'),
			second = track('two', 'wy')
		const grouped = {
			...first,
			get sourceAlternatives() {
				reads++
				return [second]
			},
		}
		const snapshot = [grouped]
		const index = groups.getFavoriteIndex(snapshot)
		const afterBuild = reads
		for (let row = 0; row < 200; row++) {
			assert.equal(groups.getFavoriteIndex(snapshot), index)
			assert.equal(index.has(second), true)
			assert.equal(index.find(second), grouped)
			assert.equal(index.has(track('missing', 'kg')), false)
		}
		assert.equal(reads, afterBuild)
		const changed = [{ ...first, sourceAlternatives: [track('three', 'kg')] }]
		const replacement = groups.getFavoriteIndex(changed)
		assert.notEqual(replacement, index)
		assert.equal(replacement.has(second), false)
		assert.equal(replacement.has(track('three', 'kg')), true)
		assert.equal(index.has(second), true)
		assert.equal(index.has(null), false)
		assert.equal(index.find(undefined), undefined)
	},
)
await check(
	'merge, undo, split and toggles replace the shared index and preserve exact platform identities',
	() => {
		const first = track('one'),
			second = track('two', 'wy')
		const h = fixture([first, second])
		const before = groups.getFavoriteIndex(h.current())
		assert.equal(before.find(second), second)
		h.mergeSelectedFavorites(
			h.current(),
			new Set([groups.getFavoriteMergeCandidates(h.current())[0].id]),
		)
		const merged = groups.getFavoriteIndex(h.current())
		assert.notEqual(before, merged)
		assert.equal(merged.find(second).id, first.id)
		h.undoFavoriteMerge()
		const restored = groups.getFavoriteIndex(h.current())
		assert.equal(restored.find(second).id, second.id)
		h.useLibraryStore.getState().toggleTrackFavorite(second)
		const removed = groups.getFavoriteIndex(h.current())
		assert.equal(removed.has(second), false)
		h.useLibraryStore.getState().toggleTrackFavorite(second)
		const linked = groups.getFavoriteIndex(h.current())
		assert.equal(linked.find(second).id, first.id)
		h.splitFavoriteGroup(first)
		const split = groups.getFavoriteIndex(h.current())
		assert.equal(split.find(second).id, second.id)
		assert.equal(split.has(track('two', 'kg')), false)
		assert.equal(groups.getFavoriteIndex([]).has(first), false)
	},
)
const react = {
	createElement: (type, props, ...children) => ({
		type,
		props: { ...props, children: children.flat().filter(Boolean) },
	}),
	useMemo: (make) => make(),
	useCallback: (callback) => callback,
	useState: (value) => [value, () => {}],
}
await check(
	'actual song menu exposes every platform, plays the chosen version and can split favorites',
	async () => {
		const h = fixture([groups.mergeFavoriteGroup([track('one'), track('two', 'wy')])]),
			played = [],
			alerts = []
		const { TrackShortcutsMenu } = loadModule(
			'src/components/TrackShortcutsMenu.tsx',
			{
				react,
				'ts-pattern': { match, P },
				'@/helpers/trackPlayerIndex': { play: async (item) => played.push(item) },
				'@/helpers/musicPlatform': {
					getMusicPlatformLabelKey: (platform) => platform,
					supportsCatalogNavigation: () => false,
				},
				'@/helpers/userApi/getMusicSource': {},
				'@/store/library': { useFavorites: () => ({ favorites: h.current() }) },
				'@/store/playList': { isInPlayList: () => false },
				'@/store/queue': { useQueue: () => ({}) },
				'@/utils/i18n': { t: (key) => key },
				'@/components/ActionMenu': { MenuView: 'MenuView' },
				'expo-router': { useFocusEffect() {}, useRouter: () => ({}) },
				'react-native': { Alert: { alert: (...args) => alerts.push(args) } },
				'@/helpers/favoriteGroups': groups,
				'@/helpers/favoriteGroupActions': h,
				'@/helpers/downloadQuality': loadModule('src/helpers/downloadQuality.ts', {
					'@/utils/i18n': { t: (key) => key },
				}),
			},
			{ React: react },
		)
		const menu = TrackShortcutsMenu({ track: h.current()[0] })
		const sources = menu.props.actions.find((action) => action.id === 'select-source')
		assert.equal(sources.title, 'menu.preferSource')
		assert.deepEqual(
			Array.from(sources.subactions, (action) => action.state),
			['on', 'off'],
		)
		assert.equal(
			menu.props.actions.find((action) => action.id === 'select-source').subactions.length,
			2,
		)
		await menu.props.onPressAction({ nativeEvent: { event: 'play-source-1' } })
		assert.equal(played[0].platform, 'wy')
		assert.equal(h.disk.get('music.favorites')[0].platform, 'wy')
		assert.equal(played[0], h.current()[0])
		const updated = TrackShortcutsMenu({ track: track('one') })
		const updatedSources = updated.props.actions.find((action) => action.id === 'select-source')
		assert.equal(updatedSources.subactions[0].title, 'wy')
		assert.equal(updatedSources.subactions[0].state, 'on')
		h.fail('music.favorites')
		await updated.props.onPressAction({ nativeEvent: { event: 'play-source-1' } })
		assert.equal(played.length, 1)
		assert.equal(h.current()[0].platform, 'wy')
		assert.equal(alerts[0][0], 'favoriteGroups.failed')
		await menu.props.onPressAction({ nativeEvent: { event: 'split-favorite' } })
		assert.equal(h.current().length, 2)
		const saved = h.current()
		const searchMenu = TrackShortcutsMenu({
			track: groups.mergeFavoriteGroup([track('external'), track('external-wy', 'wy')]),
		})
		const searchSources = searchMenu.props.actions.find((action) => action.id === 'select-source')
		assert.equal(searchSources.title, 'menu.selectSource')
		assert.equal(searchSources.subactions[0].state, 'off')
		await searchMenu.props.onPressAction({ nativeEvent: { event: 'play-source-1' } })
		assert.equal(played[1].id, 'external-wy')
		assert.equal(h.current(), saved)
	},
)
await check(
	'actual preview excludes a group, confirms the remaining group and virtualizes merged entries',
	() => {
		const h = fixture([
			track('one'),
			track('two', 'wy'),
			track('three', 'tx', { title: 'Other' }),
			track('four', 'wy', { title: 'Other' }),
		])
		const alerts = []
		let excluded = new Set()
		const Screen = loadModule(
			'src/app/(modals)/favoriteDuplicates.tsx',
			{
				react: {
					...react,
					useState: () => [
						excluded,
						(update) => {
							excluded = update(excluded)
						},
					],
				},
				'react-native': {
					View: 'View',
					Text: 'Text',
					Pressable: 'Pressable',
					Alert: { alert: (...args) => alerts.push(args) },
				},
				'@shopify/flash-list': { FlashList: 'FlashList' },
				'@/store/library': { useFavorites: () => ({ favorites: h.current() }) },
				'@/helpers/favoriteGroups': groups,
				'@/helpers/favoriteGroupActions': h,
				'@/helpers/libraryEdits': edits,
				'@/helpers/musicPlatform': { getMusicPlatformLabelKey: (platform) => platform },
				'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
				'@/utils/i18n': { t: (key) => key },
			},
			{ React: react },
		).default
		let list = Screen().props
		list.renderItem({ item: list.data[0] }).props.onPress()
		list = Screen().props
		const buttons = list.ListHeaderComponent.props.children.filter(
			(node) => node.type === 'Pressable',
		)
		buttons[0].props.onPress()
		alerts[0][2][1].onPress()
		assert.equal(h.current().length, 3)
		assert.equal(h.current().filter((item) => item.title === 'Song').length, 2)
		list = Screen().props
		assert.equal(list.data.filter((item) => item.kind === 'merged').length, 1)
		assert.equal(
			list.ListHeaderComponent.props.children.some((node) =>
				node.props?.children?.includes('Other'),
			),
			false,
		)
	},
)
finish()
