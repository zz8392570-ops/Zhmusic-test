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
function screen() {
	let stateIndex = 0
	react.useState = (initial) => [stateIndex++ === 0 ? boards : initial, () => {}]
	const Screen = loadModule(
		'src/app/(tabs)/(songs)/index.tsx',
		{
			react,
			'@/components/search/SearchPlatformSelector': 'Platforms',
			'@/components/TracksList': { TracksList: 'Tracks' },
			'@/components/DiscoveryHeading': 'Heading',
			'@/components/ChartCard': 'Card',
			'@expo/vector-icons': { Ionicons: 'Icon' },
			'@/helpers/leaderboard': {
				...leaderboard,
				getBoardSongs: (_source, id) => {
					const pending = deferred()
					requests.push({ id, ...pending })
					return pending.promise
				},
				mapLeaderboardTrack: (track) => track,
			},
			'@/helpers/miscellaneous': { generateTracksListId: () => 'charts' },
			'@/helpers/trackPlayerIndex': {
				songsNumsToLoadStore: { useValue: () => 100 },
				playWithReplacePlayList: async (track, list) => plays.push({ track, list }),
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
				]
	return find(Screen())
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
suite.finish()
