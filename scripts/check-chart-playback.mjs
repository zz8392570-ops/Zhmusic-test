import { assert, checks, deferred, flush, loadModule } from './native-services-fixture.mjs'

const boards = ['26', 'remote-new'].map((id) => ({ id: `tx__${id}`, title: id }))
const disk = new Map([
	['music.homeBoardSource', 'tx'],
	['music.homeBoardId', '26'],
])
const persist = {
	get: (key) => disk.get(key),
	set: (key, value) => disk.set(key, value),
	useValue: (key, fallback) => disk.get(key) ?? fallback,
}
const leaderboard = loadModule('src/helpers/leaderboard.ts', {
	'@/components/utils/musicSdk': { tx: { leaderboard: { list: [{ name: 'Hot', bangid: '26' }] } } },
	'@/constants/images': { unknownTrackImageUri: 'fallback' },
	'@/helpers/userApi/getMusicSource': { getTopLists() {} },
	'@/store/PersistStatus': persist,
	'@/helpers/artworkResolver': { normalizeArtworkUrl: (url) => url },
})
const suite = checks()
await suite.check(
	'new boards from remote catalogs retain their ID; source defaults remain usable',
	() => {
		leaderboard.setHomeLeaderboard('tx', 'remote-new')
		assert.equal(disk.get('music.homeBoardId'), 'remote-new')
		leaderboard.setHomeLeaderboard('tx')
		assert.equal(disk.get('music.homeBoardId'), '26')
	},
)

const plays = [],
	requests = [],
	alerts = []
let playbackRevision = 0
const getBoardSongs = (_source, id) => {
	const pending = deferred()
	requests.push({ id, ...pending })
	return pending.promise
}
const pagination = loadModule('src/helpers/leaderboardPagination.ts', {
	'@/helpers/leaderboard': { ...leaderboard, getBoardSongs, mapLeaderboardTrack: (track) => track },
})
const react = {
	createElement: (type, props, ...children) => ({
		type,
		props: { ...props, children: children.flat() },
	}),
	useMemo: (compute) => compute(),
	useCallback: (fn) => fn,
	useEffect() {},
	useRef: (value) => ({ current: value }),
}
function screen(initialTracks = []) {
	let stateIndex = 0
	react.useState = (initial) => {
		const index = stateIndex++
		return [index === 0 ? boards : index === 1 ? initialTracks : initial, () => {}]
	}
	const Screen = loadModule(
		'src/app/(tabs)/(songs)/index.tsx',
		{
			react,
			'@/components/search/SearchPlatformSelector': 'Platforms',
			'@/components/TracksList': { TracksList: 'Tracks' },
			'@/components/DiscoveryHeading': 'Heading',
			'@/components/ChartCard': 'Card',
			'@expo/vector-icons': { Ionicons: 'Icon' },
			'@/helpers/leaderboard': leaderboard,
			'@/helpers/leaderboardPagination': pagination,
			'@/helpers/miscellaneous': { generateTracksListId: () => 'charts' },
			'@/helpers/trackPlayerIndex': {
				getPlaybackRevision: () => playbackRevision,
				playWithReplacePlayList: async (track, list) => {
					playbackRevision++
					plays.push({ track, list })
				},
			},
			'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
			'@/store/PersistStatus': persist,
			'@/styles': { useDefaultStyles: () => ({}) },
			'@/utils/i18n': { t: (key) => key },
			'react-native': {
				View: 'View',
				Text: 'Text',
				Pressable: 'Button',
				ScrollView: 'Scroll',
				ActivityIndicator: 'Loading',
				RefreshControl: 'Refresh',
				Alert: { alert: (message) => alerts.push(message) },
			},
		},
		{ React: react, console: { error() {} } },
	).default
	const find = (node) =>
		!node || typeof node !== 'object'
			? []
			: [
					...(node.type === 'Card' ? [node.props] : []),
					...(node.props?.children ?? []).flatMap(find),
					...find(node.props?.ListHeaderComponent),
					...find(node.props?.ListFooterComponent),
				]
	const tree = Screen()
	const cards = find(tree)
	cards.tree = tree
	return cards
}
await suite.check(
	'card play starts its own board; a slower previous tap cannot replace it',
	async () => {
		const cards = screen()
		cards[0].onPlay()
		cards[1].onPlay()
		assert.equal(requests[1].id, 'remote-new')
		requests[1].resolve({ list: [{ id: 'new-song' }] })
		await flush()
		requests[0].resolve({ list: [{ id: 'old-song' }] })
		await flush()
		assert.equal(plays.length, 1)
		assert.equal(plays[0].track.id, 'new-song')
		assert.equal(plays[0].list.length, 1)
	},
)
await suite.check('selecting another board or platform cancels a pending card play', async () => {
	const cards = screen()
	cards[0].onPlay()
	cards[1].onPress()
	requests.at(-1).resolve({ list: [{ id: 'cancelled-song' }] })
	await flush()
	assert.equal(plays.length, 1)
	cards[0].onPlay()
	persist.set('music.homeBoardSource', 'wy')
	requests.at(-1).resolve({ list: [{ id: 'old-platform' }] })
	await flush()
	assert.equal(plays.length, 1)
	persist.set('music.homeBoardSource', 'tx')
})
await suite.check(
	'empty card results show an error without replacing the current queue',
	async () => {
		const cards = screen()
		cards[0].onPlay()
		requests.at(-1).resolve({ list: [] })
		await flush()
		assert.equal(plays.length, 1)
		assert.equal(alerts.length, 1)
	},
)
await suite.check('a later play or pause supersedes a pending chart queue', async () => {
	const cards = screen()
	const before = plays.length
	cards[0].onPlay()
	playbackRevision++
	requests.at(-1).resolve({ list: [{ id: 'obsolete' }] })
	await flush()
	assert.equal(plays.length, before)
})
await suite.check('pressing an existing chart row cancels a pending card play', async () => {
	const cards = screen([{ id: 'visible', platform: 'tx' }])
	const findTracks = (node) =>
		node?.type === 'Tracks' ? node : node?.props?.children?.map(findTracks).find(Boolean)
	const list = findTracks(cards.tree)
	assert.ok(list)
	const before = plays.length
	cards[0].onPlay()
	list.props.onTrackPress()
	requests.at(-1).resolve({ list: [{ id: 'obsolete' }] })
	await flush()
	assert.equal(plays.length, before)
})
await suite.check('complete TOP500 queue fetches all five distinct pages', async () => {
	const pages = []
	const helper = loadModule('src/helpers/leaderboardPagination.ts', {
		'@/helpers/leaderboard': {
			getBoardSongs: async (_source, _id, page) => {
				pages.push(page)
				return {
					list: Array.from({ length: 100 }, (_, i) => ({
						id: String((page - 1) * 100 + i),
						platform: 'kg',
					})),
					total: 500,
					limit: 100,
					page,
				}
			},
			mapLeaderboardTrack: (track) => track,
		},
	})
	const result = await helper.getFullLeaderboard('kg', '8888')
	assert.equal(result.length, 500)
	assert.equal(pages.join(','), '1,2,3,4,5')
	assert.equal(result.at(-1).id, '499')
})
await suite.check(
	'later page failures, empty or repeated pages cannot masquerade as a complete queue',
	async () => {
		for (const mode of ['fail', 'empty', 'repeat']) {
			const helper = loadModule('src/helpers/leaderboardPagination.ts', {
				'@/helpers/leaderboard': {
					getBoardSongs: async (_source, _id, page) => {
						if (page === 2 && mode === 'fail') throw new Error('offline')
						return {
							list: page === 2 && mode === 'empty' ? [] : [{ id: 'one' }],
							total: 2,
							limit: 1,
							page,
						}
					},
					mapLeaderboardTrack: (track) => track,
				},
			})
			await assert.rejects(helper.getFullLeaderboard('kw', '16'))
		}
	},
)
await suite.check('cancellation stops pagination before sending the next page', async () => {
	let current = true
	let calls = 0
	const helper = loadModule('src/helpers/leaderboardPagination.ts', {
		'@/helpers/leaderboard': {
			getBoardSongs: async () => {
				calls++
				current = false
				return { list: [{ id: 'one' }], total: 2, limit: 1 }
			},
			mapLeaderboardTrack: (track) => track,
		},
	})
	await assert.rejects(helper.getFullLeaderboard('kg', '8888', () => current))
	assert.equal(calls, 1)
})
suite.finish()
