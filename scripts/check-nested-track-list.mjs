import { assert, checks, loadModule } from './native-services-fixture.mjs'

const plays = []
let activeQueueId
const react = {
	memo: (component) => component,
	useMemo: (compute) => compute(),
	useCallback: (callback) => callback,
	createElement: (type, props, ...children) => ({
		type,
		props: { ...props, children: children.flat() },
	}),
}
const { TracksList } = loadModule('src/components/TracksList.tsx', {
	react,
	'@/components/TracksListItem': 'TrackRow',
	'@/constants/images': { unknownTrackImageUri: 'fallback' },
	'@/helpers/trackPlayerIndex': {
		useCurrentMusic: () => null,
		playWithReplacePlayList: async (track, list) => plays.push({ track, list }),
	},
	'@/store/queue': {
		useQueue: () => ({
			activeQueueId,
			setActiveQueueId: (value) => {
				activeQueueId = value
			},
		}),
	},
	'@/styles': { useUtilsStyles: () => ({ itemSeparator: { height: 1 } }) },
	'@/utils/mediaItem': { isSameMediaItem: () => false },
	'@shopify/flash-list': { FlashList: 'FlashList' },
	'expo-router': { router: { navigate() {} } },
	'react-native': { View: 'View', Text: 'Text' },
	'expo-image': { Image: 'Image' },
	'@rntp/player': { useIsPlaying: () => false },
	'./QueueControls': { QueueControls: 'QueueControls' },
	'@/utils/i18n': { t: (key) => key },
})
const tracks = [
	{ id: 'same', platform: 'tx', title: 'One', url: 'file:///one.mp3' },
	{ id: 'same', platform: 'wy', title: 'Two', url: 'file:///two.mp3' },
	{ id: 'three', platform: 'local', title: 'Three', url: 'file:///three.mp3' },
]
const find = (node, type) => {
	if (!node || typeof node !== 'object') return []
	return [
		...(node.type === type ? [node] : []),
		...(node.props?.children ?? []).flatMap((child) => find(child, type)),
	]
}
const suite = checks()
await suite.check(
	'nested tracks render every row in document flow with header and distinct identities',
	() => {
		const tree = TracksList({
			id: 'local',
			tracks,
			scrollEnabled: false,
			ListHeaderComponent: 'header',
		})
		assert.equal(find(tree, 'FlashList').length, 0)
		assert.equal(find(tree, 'TrackRow').length, tracks.length)
		assert.equal(find(tree, 'QueueControls').length, 1)
		const rows = tree.props.children.filter(
			(child) => child?.type === 'View' && find(child, 'TrackRow').length,
		)
		assert.equal(new Set(rows.map((row) => row.props.key)).size, tracks.length)
		assert.ok(rows.every((row) => !row.props.style?.height && !row.props.style?.position))
	},
)
await suite.check(
	'filtering and multi-select leave only current rows and retain playback of the visible queue',
	async () => {
		const visible = [tracks[2], tracks[0]]
		const selection = new Set(['three'])
		const tree = TracksList({
			id: 'filtered',
			tracks: visible,
			scrollEnabled: false,
			isMultiSelectMode: true,
			selectedTracks: selection,
		})
		const rows = find(tree, 'TrackRow')
		assert.equal(rows.map((row) => row.props.track.title).join(','), 'Three,One')
		assert.ok(
			rows.every((row) => row.props.isMultiSelectMode && row.props.selectedTracks === selection),
		)
		await rows[0].props.onTrackSelect(visible[0])
		assert.equal(plays[0].track, visible[0])
		assert.equal(plays[0].list, visible)
		assert.equal(activeQueueId, 'filtered')
	},
)
await suite.check('standalone scrolling lists still use virtualization', () => {
	const tree = TracksList({ id: 'scrolling', tracks })
	assert.equal(tree.type, 'FlashList')
	assert.equal(tree.props.data, tracks)
	assert.notEqual(tree.props.keyExtractor(tracks[0]), tree.props.keyExtractor(tracks[1]))
})
suite.finish()
