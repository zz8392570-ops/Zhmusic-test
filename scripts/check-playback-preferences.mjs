import { Buffer } from 'node:buffer'
import { match, P } from 'ts-pattern'
import { assert, checks, loadModule } from './native-services-fixture.mjs'

const { check, finish } = checks()
const rules = loadModule('src/helpers/dislikeRules.ts', {})
const song = (id, extra = {}) => ({
	id,
	platform: 'tx',
	title: 'Song',
	artist: 'Singer',
	url: 'Unknown',
	...extra,
})
const react = {
	createElement: (type, props, ...children) => ({
		type,
		props: { ...props, children: children.flat().filter(Boolean) },
	}),
	useMemo: (make) => make(),
	useCallback: (callback) => callback,
	useState: (value) => [value, () => {}],
}
function fixture() {
	const values = new Map()
	const persist = {
		get: (key) => (values.has(key) ? JSON.parse(values.get(key)) : null),
		set: (key, value) => {
			if (value === undefined) values.delete(key)
			else values.set(key, JSON.stringify(value))
		},
		useValue: (key, fallback) => persist.get(key) ?? fallback ?? null,
	}
	const queue = loadModule('src/player/PlayLaterQueue.ts', { '@/store/PersistStatus': persist })
	return { values, persist, queue }
}
function nodes(tree) {
	if (!tree || typeof tree !== 'object') return []
	return [tree, ...(tree.props?.children ?? []).flatMap(nodes)]
}
const button = (tree, title) =>
	nodes(tree).find((node) => node.type === 'Button' && node.props.title === title)

await check(
	'dislike matching normalizes text across providers and keeps versions and unrelated artists separate',
	() => {
		const rule = rules.createDislikeRule('song', 'Singer', 'Ｓｏｎｇ')
		const blocked = rules.createDislikeMatcher([rule])
		assert.equal(blocked(song('a', { platform: 'wy', title: ' song ' })), true)
		assert.equal(blocked(song('a', { title: 'Song (Live)' })), false)
		assert.equal(blocked(song('a', { title: 'Song Remix' })), false)
		assert.equal(blocked(song('a', { artist: 'Someone else' })), false)
		assert.equal(rules.createDislikeRule('song', '', 'Song'), null)
		assert.equal(rules.normalizeDislikeRules([rule, { ...rule, id: 'different-id' }]).length, 1)
		const artistRule = rules.createDislikeMatcher([rules.createDislikeRule('artist', 'Singer')])
		assert.equal(artistRule(song('a', { artist: 'Someone、Singer' })), true)
		assert.equal(artistRule(song('a', { artist: 'Singer feat. Guest' })), true)
		assert.equal(artistRule(song('a', { artist: 'Singer Junior' })), false)
		assert.deepEqual(Array.from(rules.getDislikeArtists(song('band', { artist: 'AC/DC' }))), [
			'AC/DC',
		])
	},
)
await check(
	'play-later editing deduplicates exact identities, preserves order and rejects an overfull batch atomically',
	() => {
		const h = fixture(),
			a = song('a'),
			b = song('b'),
			other = song('a', { platform: 'wy' })
		assert.equal(h.queue.enqueuePlayLater([a, a, b, other]), 3)
		const initial = h.queue.getPlayLaterState()
		h.queue.movePlayLater(2, 0)
		assert.equal(h.queue.getPlayLaterState().pending[0].track.platform, 'wy')
		h.queue.removePlayLater(initial.pending[1].id)
		assert.equal(h.queue.getPlayLaterState().pending.length, 2)
		assert.equal(h.queue.movePlayLater(-1, 0), false)
		const before = h.values.get('music.playLater')
		assert.throws(
			() => h.queue.enqueuePlayLater(Array.from({ length: 1001 }, (_, i) => song('batch-' + i))),
			/full/,
		)
		assert.equal(h.values.get('music.playLater'), before)
		const restarted = loadModule('src/player/PlayLaterQueue.ts', {
			'@/store/PersistStatus': h.persist,
		})
		assert.equal(
			restarted.getPlayLaterState().pending[0].id,
			h.queue.getPlayLaterState().pending[0].id,
		)
	},
)
await check(
	'dislike rules survive backup round trips and invalid rules are rejected before restoration',
	() => {
		const h = fixture()
		const backup = loadModule('src/helpers/musicBackup.ts', {
			'@/helpers/favoriteGroups': loadModule('src/helpers/favoriteGroups.ts', {}),
			'@/helpers/dislikeRules': rules,
			'@/helpers/downloadFilename': loadModule('src/helpers/downloadFilename.ts', {
				buffer: { Buffer },
			}),
			'@/store/PersistStatus': h.persist,
			buffer: { Buffer },
		})
		const savedRules = [rules.createDislikeRule('artist', 'Singer')]
		h.persist.set('music.dislikeRules', savedRules)
		const exported = backup.createMusicBackup('test')
		h.persist.set('music.dislikeRules', [])
		backup.restoreMusicBackup(exported, 'merge', true)
		assert.equal(h.persist.get('music.dislikeRules')[0].artist, 'Singer')
		exported.settings['music.dislikeRules'] = [
			{ id: 'invalid', kind: 'song', title: 'Song', artist: '' },
		]
		assert.throws(() => backup.parseMusicBackup(JSON.stringify(exported)), /Invalid backup setting/)
	},
)
await check(
	'the actual song menu forwards play-later and specific song/artist rules without changing favorites',
	async () => {
		const calls = [],
			artists = song('menu', { artist: 'Singer、Guest' })
		const { TrackShortcutsMenu } = loadModule(
			'src/components/TrackShortcutsMenu.tsx',
			{
				react,
				'ts-pattern': { match, P },
				'@/helpers/dislikeRules': rules,
				'@/helpers/trackPlayerIndex': {
					addToPlayLater: async (track) => calls.push(['later', track.id]),
					dislikeSong: (track) => calls.push(['song', track.id]),
					dislikeArtist: (artist) => calls.push(['artist', artist]),
				},
				'@/helpers/musicPlatform': {
					getMusicPlatformLabelKey: () => null,
					supportsCatalogNavigation: () => false,
				},
				'@/helpers/userApi/getMusicSource': {},
				'@/store/library': { useFavorites: () => ({ favorites: [] }) },
				'@/store/playList': { isInPlayList: () => false },
				'@/store/queue': { useQueue: () => ({}) },
				'@/utils/i18n': { t: (key) => key },
				'@/components/ActionMenu': { MenuView: 'Menu' },
				'expo-router': { useFocusEffect() {}, useRouter: () => ({}) },
				'react-native': { Alert: { alert() {} } },
				'@/helpers/favoriteGroups': loadModule('src/helpers/favoriteGroups.ts', {}),
				'@/helpers/favoriteGroupActions': {},
				'@/helpers/downloadQuality': loadModule('src/helpers/downloadQuality.ts', {
					'@/utils/i18n': { t: (key) => key },
				}),
			},
			{ React: react },
		)
		const menu = TrackShortcutsMenu({ track: artists })
		assert.equal(menu.props.actions.find((action) => action.id === 'dislike').subactions.length, 3)
		for (const event of ['play-later', 'dislike-song', 'dislike-artist-1'])
			await menu.props.onPressAction({ nativeEvent: { event } })
		assert.deepEqual(calls, [
			['later', 'menu'],
			['song', 'menu'],
			['artist', 'Guest'],
		])
	},
)
await check(
	'actual management screens remove and reorder saved entries and require confirmation for clear',
	async () => {
		const h = fixture(),
			alerts = [],
			played = []
		h.queue.enqueuePlayLater([song('a'), song('b')])
		h.persist.set('music.dislikeRules', [rules.createDislikeRule('song', 'Singer', 'Song')])
		const facade = {
			clearPlayLater: () => h.queue.clearPlayLater(),
			removePlayLater: h.queue.removePlayLater,
			movePlayLater: h.queue.movePlayLater,
			playLaterNow: async (id) => played.push(id),
			removeDislikeRule: (id) =>
				h.persist.set(
					'music.dislikeRules',
					h.persist.get('music.dislikeRules').filter((rule) => rule.id !== id),
				),
			clearDislikeRules: () => h.persist.set('music.dislikeRules', []),
		}
		const modules = {
			'react-native': {
				Alert: { alert: (...args) => alerts.push(args) },
				FlatList: 'List',
				View: 'View',
				Text: 'Text',
				Pressable: 'Pressable',
			},
			'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
			'@/store/PersistStatus': h.persist,
			'@/player/PlayLaterQueue': h.queue,
			'@/helpers/dislikeRules': rules,
			'@/helpers/trackPlayerIndex': facade,
			'@/utils/i18n': { t: (key) => key },
			'@/components/LibraryToolButton': { LibraryToolButton: 'Button' },
		}
		const Later = loadModule('src/app/(modals)/playLater.tsx', modules, { React: react }).default
		let tree = Later()
		let row = tree.props.renderItem({ item: tree.props.data[0], index: 0 })
		await nodes(row)
			.find((node) => node.type === 'Pressable')
			.props.onPress()
		assert.equal(played[0], tree.props.data[0].id)
		await button(row, 'queue.moveDown').props.onPress()
		assert.equal(h.queue.getPlayLaterState().pending[0].track.id, 'b')
		tree = Later()
		row = tree.props.renderItem({ item: tree.props.data[0], index: 0 })
		await button(row, 'queue.remove').props.onPress()
		assert.equal(h.queue.getPlayLaterState().pending[0].track.id, 'a')
		h.queue.enqueuePlayLater([song('b')])
		tree = Later()
		button(tree.props.ListHeaderComponent, 'playLater.clear').props.onPress()
		assert.equal(h.queue.getPlayLaterState().pending.length, 2)
		await alerts.at(-1)[2].at(-1).onPress()
		assert.equal(h.queue.getPlayLaterState().pending.length, 0)
		const Dislikes = loadModule('src/app/(modals)/dislikes.tsx', modules, { React: react }).default
		tree = Dislikes()
		button(tree.props.ListHeaderComponent, 'dislikes.clear').props.onPress()
		assert.equal(h.persist.get('music.dislikeRules').length, 1)
		alerts.at(-1)[2].at(-1).onPress()
		assert.equal(h.persist.get('music.dislikeRules').length, 0)
		h.persist.set('music.dislikeRules', [rules.createDislikeRule('artist', 'Singer')])
		tree = Dislikes()
		row = tree.props.renderItem({ item: tree.props.data[0] })
		button(row, 'dislikes.remove').props.onPress()
		assert.equal(h.persist.get('music.dislikeRules').length, 0)
	},
)

await check(
	'actual play-all and shuffle controls request automatic selection after setting the intended mode',
	async () => {
		const events = []
		const { QueueControls } = loadModule(
			'src/components/QueueControls.tsx',
			{
				react,
				'@/helpers/trackPlayerIndex': {
					MusicRepeatMode: { QUEUE: 'QUEUE', SHUFFLE: 'SHUFFLE' },
					setRepeatMode: (mode) => events.push(['mode', mode]),
					playWithReplacePlayList: async (_first, tracks, automatic) =>
						events.push(['play', tracks.length, automatic]),
				},
				'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
				'@/styles': { useDefaultStyles: () => ({}) },
				'@/utils/i18n': { t: (key) => key },
				'@expo/vector-icons': { Ionicons: 'Icon' },
				'lodash.shuffle': (tracks) => [...tracks].reverse(),
				'@/components/ActionMenu': { MenuView: 'Menu' },
				'@/utils/haptics': { hapticLight() {}, hapticSelection() {} },
				'@/helpers/downloadQuality': {
					getDownloadQuality() {},
					getDownloadQualityActions: () => [],
				},
				'react-native': {
					Alert: { alert() {} },
					StyleSheet: { create: (styles) => styles },
					Text: 'Text',
					View: 'View',
					TouchableOpacity: 'Control',
				},
			},
			{ React: react },
		)
		const tree = QueueControls({ tracks: [song('a'), song('b')] })
		for (const name of ['playButton.play', 'playButton.shuffle'])
			await nodes(tree)
				.find((node) => node.type === 'Control' && node.props.accessibilityLabel === name)
				.props.onPress()
		assert.deepEqual(events, [
			['mode', 'QUEUE'],
			['play', 2, true],
			['mode', 'SHUFFLE'],
			['play', 2, true],
		])
	},
)

finish()
