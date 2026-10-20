import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { assert, checks, loadModule, root } from './native-services-fixture.mjs'

const plays = []
const events = []
let activeQueueId
let currentMusic = null
const navigations = []
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
		useCurrentMusic: () => currentMusic,
		playWithReplacePlayList: async (track, list) => {
			events.push('play')
			plays.push({ track, list })
		},
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
	'@/helpers/favoritePlayback': loadModule('src/helpers/favoritePlayback.ts', {
		'./favoriteGroups': loadModule('src/helpers/favoriteGroups.ts', {}),
	}),
	'@shopify/flash-list': { FlashList: 'FlashList' },
	'expo-router': { router: { navigate: (route) => navigations.push(route) } },
	'react-native': { View: 'View', Text: 'Text' },
	'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 34 }) },
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
	'large track lists defer all row rendering to one bounded virtual scroller',
	() => {
		const many = Array.from({ length: 10_000 }, (_, index) => ({
			id: String(index),
			platform: 'tx',
		}))
		const data = new Proxy(many, {
			get(target, property) {
				if (property === 'map') throw new Error('Production eagerly mapped every row')
				return Reflect.get(target, property)
			},
		})
		const tree = TracksList({
			id: 'local',
			tracks: data,
			ListHeaderComponent: 'header',
		})
		assert.equal(tree.type, 'FlashList')
		assert.equal(tree.props.data, data)
		assert.equal(tree.props.style.flex, 1)
		assert.equal(tree.props.scrollEnabled, true)
		assert.equal(find(tree, 'TrackRow').length, 0)
		assert.equal(find(tree.props.ListHeaderComponent, 'QueueControls').length, 1)
		assert.equal(tree.props.ListHeaderComponent.props.children[0], 'header')
		const visibleRow = tree.props.renderItem({ item: data[9000], index: 9000 })
		assert.equal(visibleRow.props.track, data[9000])
		assert.equal(new Set(tracks.map(tree.props.keyExtractor)).size, tracks.length)
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
			isMultiSelectMode: true,
			selectedTracks: selection,
			onTrackPress: () => events.push('cancel'),
		})
		const rows = visible.map((item, index) => tree.props.renderItem({ item, index }))
		assert.equal(rows.map((row) => row.props.track.title).join(','), 'Three,One')
		assert.ok(
			rows.every((row) => row.props.isMultiSelectMode && row.props.selectedTracks === selection),
		)
		await rows[0].props.onTrackSelect(visible[0])
		assert.equal(plays[0].track, visible[0])
		assert.equal(plays[0].list, visible)
		assert.equal(activeQueueId, 'filtered')
		assert.equal(events.join(','), 'cancel,play')
	},
)
await suite.check(
	'an automatic platform fallback keeps the original row active and opens the player without replacing its queue',
	async () => {
		currentMusic = {
			id: 'alternate',
			platform: 'kg',
			playbackQueueOrigin: { id: tracks[0].id, platform: tracks[0].platform },
		}
		const tree = TracksList({ id: 'favorites', tracks })
		const active = tree.props.renderItem({ item: tracks[0], index: 0 })
		const otherPlatform = tree.props.renderItem({ item: tracks[1], index: 1 })
		assert.equal(active.props.isActiveTrack, true)
		assert.equal(otherPlatform.props.isActiveTrack, false)
		const oldPlays = plays.length
		await active.props.onTrackSelect(tracks[0])
		assert.equal(plays.length, oldPlays)
		assert.equal(navigations[0], '/player')
		currentMusic = null
	},
)
await suite.check('standalone scrolling lists still use virtualization', () => {
	const tree = TracksList({ id: 'scrolling', tracks })
	assert.equal(tree.type, 'FlashList')
	assert.equal(tree.props.data, tracks)
	assert.notEqual(tree.props.keyExtractor(tracks[0]), tree.props.keyExtractor(tracks[1]))
})

await suite.check(
	'refresh, load-more footer and explicit empty state belong to the primary scroller',
	() => {
		let refreshes = 0
		let pages = 0
		const refreshControl = react.createElement('RefreshControl', { onRefresh: () => refreshes++ })
		const footer = react.createElement('LoadMore', { onPress: () => pages++ })
		const tree = TracksList({
			id: 'paged',
			tracks,
			ListFooterComponent: footer,
			refreshControl,
			onEndReached: () => pages++,
			onEndReachedThreshold: 0.3,
			ListEmptyComponent: null,
		})
		assert.equal(tree.props.refreshControl, refreshControl)
		assert.equal(tree.props.onEndReachedThreshold, 0.3)
		assert.equal(tree.props.ListEmptyComponent, null)
		assert.equal(find(tree.props.ListFooterComponent, 'LoadMore').length, 1)
		tree.props.refreshControl.props.onRefresh()
		tree.props.onEndReached()
		find(tree.props.ListFooterComponent, 'LoadMore')[0].props.onPress()
		assert.equal(refreshes, 1)
		assert.equal(pages, 2)
	},
)

await suite.check('tab clearance includes the device safe area and modals can override it', () => {
	const tabs = TracksList({ id: 'tabs', tracks })
	const modal = TracksList({ id: 'modal', tracks, contentContainerStyle: { paddingBottom: 32 } })
	const flatten = (styles) => Object.assign({}, ...styles.filter(Boolean))
	assert.equal(flatten(tabs.props.contentContainerStyle).paddingBottom, 162)
	assert.equal(flatten(modal.props.contentContainerStyle).paddingBottom, 32)
})

await suite.check(
	'playlist filters and import, management, delete and selection callbacks stay connected',
	() => {
		const keyOf = (track) => JSON.stringify([track.platform, track.id])
		const { PlaylistTracksList } = loadModule(
			'src/components/PlaylistTracksList.tsx',
			{
				react: { ...react, useState: (value) => [value, () => {}] },
				'@/constants/images': { unknownTrackImageUri: 'fallback' },
				'@/constants/tokens': { fontSize: { lg: 24 } },
				'@/helpers/miscellaneous': { generateTracksListId: (id) => id },
				'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
				'@/styles': { useDefaultStyles: () => ({ text: {} }) },
				'@/utils/i18n': { t: (key) => key },
				'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: (styles) => styles } },
				'expo-image': { Image: 'Image' },
				'./QueueControls': { QueueControls: 'QueueControls' },
				'./TracksList': { TracksList },
				'@/helpers/libraryEdits': { getLibraryTrackKey: keyOf },
			},
			{ React: react },
		)
		const importTrack = () => {}
		const deleteTrack = () => {}
		const selectedAction = () => {}
		const managementAction = () => {}
		const playlistTree = PlaylistTracksList({
			playlist: { id: 'playlist', title: 'Library' },
			tracks,
			headerContent: react.createElement('Filters', {}),
			footerContent: react.createElement('Footer', {}),
			showImportMenu: true,
			onImportTrack: importTrack,
			onDeleteTrack: deleteTrack,
			onSelectedAction: selectedAction,
			managementActions: [{ id: 'repair', title: 'Repair' }],
			onManagementAction: managementAction,
			isMultiSelectMode: true,
			selectedTracks: new Set(tracks.map(keyOf)),
		})
		assert.equal(playlistTree.type, TracksList)
		const tree = TracksList(playlistTree.props)
		assert.equal(tree.type, 'FlashList')
		assert.equal(find(tree.props.ListHeaderComponent, 'Filters').length, 1)
		assert.equal(find(tree.props.ListFooterComponent, 'Footer').length, 1)
		const controls = find(tree.props.ListHeaderComponent, 'QueueControls')[0]
		assert.equal(controls.props.onImportTrack, importTrack)
		assert.equal(controls.props.onSelectedAction, selectedAction)
		assert.equal(controls.props.onManagementAction, managementAction)
		assert.equal(controls.props.isAllSelected, true)
		assert.equal(controls.props.tracks, tracks)
		assert.equal(
			tree.props.renderItem({ item: tracks[0], index: 0 }).props.onDeleteTrack,
			deleteTrack,
		)
	},
)

await suite.check(
	'detail routes do not nest the primary virtual list in a parent ScrollView',
	() => {
		const files = [
			'src/app/(tabs)/favorites/[name].tsx',
			'src/app/(tabs)/favorites/favoriteMusic.tsx',
			'src/app/(tabs)/favorites/localMusic.tsx',
			'src/app/(tabs)/favorites/recentMusic.tsx',
			'src/app/(tabs)/favorites/smartPlaylist.tsx',
			'src/app/(tabs)/radio/[name].tsx',
			'src/app/(tabs)/search/[name].tsx',
			'src/app/(modals)/[name].tsx',
			'src/components/PlaylistTracksList.tsx',
			'src/components/SingerTracksList.tsx',
		]
		for (const file of files) {
			const text = fs.readFileSync(path.join(root, file), 'utf8')
			const source = ts.createSourceFile(
				file,
				text,
				ts.ScriptTarget.Latest,
				true,
				ts.ScriptKind.TSX,
			)
			const inspect = (node) => {
				if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
					assert.notEqual(
						node.tagName.getText(source),
						'ScrollView',
						`${file} contains a parent scroller`,
					)
					if (node.tagName.getText(source) === 'TracksList') {
						assert(
							!node.attributes.properties.some(
								(attribute) =>
									ts.isJsxAttribute(attribute) &&
									attribute.name.getText(source) === 'scrollEnabled',
							),
							`${file} disables its primary scroller`,
						)
					}
				}
				ts.forEachChild(node, inspect)
			}
			inspect(source)
		}
	},
)
suite.finish()
