import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { assert, checks, flush, loadModule, root } from './native-services-fixture.mjs'
const { check, finish } = checks()
const offsets = loadModule('src/helpers/trackLyricOffset.ts', {})
const groups = loadModule('src/helpers/favoriteGroups.ts', {})
const membership = loadModule('src/helpers/trackLibraryMembership.ts', {
	'./favoriteGroups': groups,
})
const versionInfo = loadModule('src/helpers/trackVersionInfo.ts', {})
const song = (id = 'one', platform = 'tx', extra = {}) => ({
	id,
	platform,
	title: 'Song',
	artist: 'Singer',
	album: 'Album',
	duration: 200,
	url: 'Unknown',
	...extra,
})
const react = {
	createElement: (type, props, ...children) => ({
		type,
		props: { ...props, children: children.flat().filter((x) => x !== null && x !== false) },
	}),
	useMemo: (fn) => fn(),
}
const nodes = (node) =>
	node && typeof node === 'object' ? [node, ...(node.props?.children ?? []).flatMap(nodes)] : []
const strings = (node) =>
	node && typeof node === 'object'
		? (node.props?.children ?? []).flatMap(strings)
		: typeof node === 'string'
			? [node]
			: []
const i18n = { t: (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key) }
function storage() {
	const disk = new Map(),
		listeners = new Set()
	let failed = false,
		reads = 0
	return {
		disk,
		listeners,
		fail: () => {
			failed = true
		},
		reads: () => reads,
		get: (key) => {
			if (key === 'lyric.trackOffsets') reads++
			return disk.get(key) ?? null
		},
		set: (key, value) => {
			if (failed) {
				failed = false
				throw Error('disk failed')
			}
			disk.set(key, value)
			for (const listener of listeners) listener(key)
		},
		subscribe: (listener) => {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
	}
}
await check(
	'lyric offsets separate platform recordings and share downloaded original IDs without changing the legacy default',
	() => {
		const a = song(),
			b = song('two'),
			other = song('one', 'kw')
		const map = offsets.withTrackLyricDelay(a, null, 1.5)
		assert.equal(offsets.getTrackLyricDelay(a, map, 0.5), 1.5)
		assert.equal(
			offsets.getTrackLyricDelay({ ...a, id: 'cache:collision', originalId: a.id }, map),
			1.5,
		)
		assert.equal(offsets.getTrackLyricDelay(b, map, 0.5), 0.5)
		assert.equal(offsets.getTrackLyricDelay(other, map, 0.5), 0.5)
		assert.equal(offsets.getTrackLyricDelay(song('one', 'local'), map, 0.5), 0.5)
		const reset = offsets.withTrackLyricDelay(a, map, 0)
		assert.equal(offsets.getTrackLyricDelay(a, reset, 0.5), 0)
		assert.equal(map[offsets.getTrackLyricOffsetKey(a)], 1.5)
		assert.equal(offsets.getTrackLyricDelay(a, null, '2'), 0)
		assert.equal(offsets.getTrackLyricDelay(a, null, Infinity), 0)
	},
)
await check(
	'lyric preference validation bounds identity, timing and record count; valid updates preserve unrelated songs',
	() => {
		const a = song('a'),
			b = song('b'),
			key = offsets.getTrackLyricOffsetKey(a)
		const map = offsets.withTrackLyricDelay(a, offsets.withTrackLyricDelay(b, {}, -2), 99)
		assert.equal(map[key], 15)
		assert.equal(map[offsets.getTrackLyricOffsetKey(b)], -2)
		assert.equal(offsets.isValidTrackLyricOffsets(map), true)
		for (const value of [
			null,
			[],
			{ bad: 1 },
			{ [key]: '1' },
			{ [key]: Infinity },
			{ [key]: -16 },
			{ '[ "tx", "a" ]': 1 },
			{ '["tx"]': 1 },
		])
			assert.equal(offsets.isValidTrackLyricOffsets(value), false)
		assert.throws(() => offsets.withTrackLyricDelay(a, {}, NaN), /Invalid/)
		const full = Object.fromEntries(
			Array.from({ length: offsets.MAX_TRACK_LYRIC_OFFSETS }, (_, index) => [
				JSON.stringify(['tx', String(index)]),
				0,
			]),
		)
		assert.equal(offsets.isValidTrackLyricOffsets(full), true)
		assert.throws(() => offsets.withTrackLyricDelay(a, full, 1), /limit/)
		assert.equal(offsets.withTrackLyricDelay(song('0'), full, 2)['["tx","0"]'], 2)
	},
)
await check(
	'actual lyric manager applies saved song timing to original and translated lyrics, refreshes on storage change and retires subscriptions',
	async () => {
		const persist = storage(),
			listeners = new Map()
		let current = song(),
			position = 4,
			cleanup
		class GlobalState {
			constructor(value) {
				this.value = value
			}
			getValue = () => this.value
			setValue = (value) => {
				this.value = value
			}
			useValue = () => this.value
		}
		const source = new GlobalState({
			rawLrc: '[00:00.00]zero\n[00:03.00]three',
			translation: '[00:00.00]零\n[00:03.00]三',
		})
		const load = () =>
			loadModule(
				'src/helpers/lyricManager.ts',
				{
					'@/store/PersistStatus': persist,
					'./trackLyricOffset': offsets,
					'@/utils/mediaItem': {
						isSameMediaItem: (a, b) => !!a && !!b && a.id === b.id && a.platform === b.platform,
					},
					'@/utils/stateMapper': { GlobalState },
					'@/utils/lrcParser': loadModule('src/utils/lrcParser.ts', {}),
					'@rntp/player': {
						Event: { PlaybackProgressUpdated: 'progress', MediaItemTransition: 'transition' },
						addEventListener: (event, fn) => {
							listeners.set(event, fn)
							return { remove: () => listeners.delete(event) }
						},
					},
					'./trackPlayerIndex': {
						__esModule: true,
						nowLyricState: source,
						default: {
							getCurrentMusic: () => current,
							getProgress: () => ({ position }),
							isCurrentProgressEvent: () => true,
							isCurrentNativeItem: () => true,
						},
					},
				},
				{},
				{
					dispose: (fn) => {
						cleanup = fn
					},
				},
			).default
		persist.set('lyric.delaySeconds', 0.5)
		let manager = load()
		await manager.refreshLyric()
		assert.equal(manager.getCurrentLyric().lrc, 'three')
		persist.set('lyric.trackOffsets', offsets.withTrackLyricDelay(current, {}, 2))
		await flush()
		assert.equal(manager.getCurrentLyric().lrc, 'zero')
		assert.equal(
			manager.getLyricState().translationLyrics[
				manager.getLyricState().lyricParser.getPosition(4).index
			].lrc,
			'零',
		)
		const reads = persist.reads()
		for (let i = 0; i < 50; i++) listeners.get('progress')({ position: 4, duration: 200 })
		assert.equal(
			persist.reads(),
			reads,
			'Progress must not deserialize the offset collection repeatedly',
		)
		current = song('second')
		await manager.refreshLyric()
		assert.equal(manager.getCurrentLyric().lrc, 'three')
		current = song('cache:renamed', 'tx', { originalId: 'one' })
		await manager.refreshLyric()
		assert.equal(manager.getCurrentLyric().lrc, 'zero')
		cleanup()
		assert.equal(persist.listeners.size, 0)
		assert.equal(listeners.size, 0)
		manager = load()
		await manager.refreshLyric()
		assert.equal(manager.getCurrentLyric().lrc, 'zero')
		persist.set(
			'lyric.trackOffsets',
			offsets.withTrackLyricDelay(current, persist.get('lyric.trackOffsets'), 0),
		)
		assert.equal(manager.getCurrentLyric().lrc, 'three')
		cleanup()
	},
)
await check(
	'actual player offset buttons use the latest saved value, reject a switched song and report persistence failures',
	() => {
		const text = fs.readFileSync(root + '/src/app/player.tsx', 'utf8')
		const source = ts.createSourceFile(
			'player.tsx',
			text,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TSX,
		)
		let declaration
		const visit = (node) => {
			if (ts.isFunctionDeclaration(node) && node.name?.text === 'updateLyricDelay')
				declaration = node.getText(source)
			ts.forEachChild(node, visit)
		}
		visit(source)
		assert.ok(declaration)
		const persist = storage(),
			rendered = song(),
			notices = []
		let current = rendered
		const context = {
			...offsets,
			currentActiveTrack: rendered,
			myTrackPlayer: { getCurrentMusic: () => current },
			PersistStatus: persist,
			showToast: (...args) => notices.push(args),
			i18n,
			LYRIC_DELAY_MIN: -15,
			LYRIC_DELAY_MAX: 15,
		}
		const compiled = ts.transpileModule(declaration + '\nupdateLyricDelay', {
			compilerOptions: { target: ts.ScriptTarget.ES2022 },
		}).outputText
		const update = vm.runInNewContext(compiled, context)
		update(0.5)
		update(0.5)
		assert.equal(offsets.getTrackLyricDelay(rendered, persist.get('lyric.trackOffsets')), 1)
		update(0, true)
		assert.equal(offsets.getTrackLyricDelay(rendered, persist.get('lyric.trackOffsets')), 0)
		persist.fail()
		update(0.5)
		assert.equal(notices.at(-1)[0], 'player.lyricDelayFailed')
		current = song('different')
		update(0.5)
		assert.equal(notices.at(-1)[0], 'player.lyricTrackChanged')
		assert.equal(persist.disk.has('lyric.delaySeconds'), false)
		assert.equal(Object.keys(persist.get('lyric.trackOffsets')).length, 1)
	},
)
await check(
	'library membership follows original IDs and grouped versions, deduplicates playlists and refreshes on immutable edits',
	() => {
		const a = song(),
			b = song('two', 'kw'),
			group = groups.mergeFavoriteGroup([a, b])
		const playlists = [
			{ id: 'p', name: 'Commute', songs: [a, a] },
			{ id: 'q', name: 'Evening', songs: [b] },
		]
		const status = membership.getTrackLibraryMembership(b, [group], playlists)
		assert.equal(status.favorite, true)
		assert.equal(status.collections.length, 2)
		assert.equal(
			membership.getTrackLibraryMembership(
				{ ...a, id: 'cached', originalId: a.id },
				[group],
				playlists,
			).collections.length,
			2,
		)
		assert.equal(membership.getTrackLibraryMembership(a, [], [playlists[0]]).collections.length, 1)
		assert.equal(
			membership.getTrackLibraryMembership(a, [], [{ ...playlists[0], songs: [] }]).collections
				.length,
			0,
		)
		for (const outsider of [
			song('unrelated'),
			song('unknown', 'wy', { duration: 0 }),
			song('cover', 'kw', { title: 'Song Live' }),
			song('one', 'local'),
		]) {
			const result = membership.getTrackLibraryMembership(outsider, [group], playlists)
			assert.equal(result.favorite, false)
			assert.equal(result.collections.length, 0)
		}
		const search = { ...a, sourceAlternatives: [b] }
		const alternate = membership.getTrackLibraryMembership(search, [b], playlists)
		assert.equal(alternate.favorite, false)
		assert.equal(alternate.otherFavorite, true)
		assert.equal(
			membership.getTrackLibraryMembership(
				{ ...search, sourceAlternatives: [{ ...b, duration: 0 }] },
				[b],
				[],
			).otherFavorite,
			false,
		)
	},
)
await check(
	'membership label shows favorite and collection changes without reading or writing audio',
	() => {
		let playlists = [{ id: 'p', name: 'Commute', songs: [song()] }]
		const Label = loadModule(
			'src/components/LibraryMembershipLabel.tsx',
			{
				react,
				'react-native': { Text: 'Text' },
				'@/player/PlayerStore': { playListsStore: { useValue: () => playlists } },
				'@/helpers/trackLibraryMembership': membership,
				'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
				'@/utils/i18n': i18n,
			},
			{ React: react },
		).default
		assert.ok(
			strings(Label({ track: song(), favorites: [song()] }))
				.join()
				.includes('favorited'),
		)
		assert.ok(
			strings(Label({ track: song(), favorites: [] }))
				.join()
				.includes('Commute'),
		)
		playlists = []
		assert.equal(Label({ track: song(), favorites: [] }), null)
	},
)
await check(
	'version details show real album/title, unknown duration and verified file state separately',
	() => {
		let state = 'available'
		const Details = loadModule(
			'src/components/TrackVersionDetails.tsx',
			{
				react,
				'react-native': { View: 'View', Text: 'Text' },
				'@/hooks/usePlaylistOffline': { usePlaylistOffline: () => [{ state }] },
				'@/helpers/trackVersionInfo': versionInfo,
				'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
				'@/utils/i18n': i18n,
			},
			{ React: react },
		).TrackVersionDetails
		const track = song('version', 'kw', { duration: 0, title: 'Song Live', album: 'Live album' })
		let text = strings(Details({ track })).join(' ')
		assert.ok(text.includes('Song Live'))
		assert.ok(text.includes('Live album'))
		assert.ok(text.includes('unknownDuration'))
		assert.ok(text.includes('offlineAvailable'))
		state = 'missing'
		text = strings(Details({ track })).join(' ')
		assert.ok(text.includes('offline.missing'))
		assert.equal(text.includes('offlineAvailable'), false)
		for (const bad of [0, -1, NaN, Infinity, '200', undefined])
			assert.equal(versionInfo.formatVersionDuration(bad), null)
		assert.equal(versionInfo.formatVersionDuration(226), '3:46')
	},
)
await check(
	'actual version screen saves the selected default, keeps the default button disabled and reports stale or failed saves',
	() => {
		const persist = storage(),
			toasts = [],
			alerts = [],
			a = song(),
			b = song('two', 'kw')
		let favorites = [groups.mergeFavoriteGroup([a, b])]
		const actions = loadModule('src/helpers/favoriteGroupActions.ts', {
			'@/store/PersistStatus': persist,
			'@/store/library': {
				useLibraryStore: { getState: () => ({ favorites }) },
				replaceFavorites: (next) => {
					persist.set('music.favorites', next)
					favorites = next
				},
			},
			'./libraryEdits': loadModule('src/helpers/libraryEdits.ts', {}),
			'./favoriteGroups': groups,
		})
		const Screen = loadModule(
			'src/app/(modals)/favoriteVersions.tsx',
			{
				react,
				'react-native': {
					Alert: { alert: (...args) => alerts.push(args) },
					FlatList: 'List',
					Text: 'Text',
					View: 'View',
				},
				'expo-router': { useLocalSearchParams: () => ({}), router: { push() {} } },
				'@/store/library': { useFavorites: () => ({ favorites }) },
				'@/helpers/favoriteGroups': groups,
				'@/helpers/favoriteGroupActions': actions,
				'@/helpers/musicPlatform': { getMusicPlatformLabelKey: (platform) => platform },
				'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
				'@/components/LibraryToolButton': { LibraryToolButton: 'Button' },
				'@/components/TrackVersionDetails': { TrackVersionDetails: 'Details' },
				'@/utils/utils': { showToast: (...args) => toasts.push(args) },
				'@/utils/i18n': i18n,
			},
			{ React: react },
		).default
		let tree = Screen(),
			row = tree.props.renderItem({ item: favorites[0] })
		let buttons = nodes(row).filter((node) => node.type === 'Button')
		assert.equal(buttons[0].props.disabled, true)
		const choose = buttons.find((button) => button.props.title === 'versions.setDefault')
		choose.props.onPress()
		assert.equal(favorites[0].platform, 'kw')
		assert.equal(toasts[0][0], 'versions.defaultSaved')
		tree = Screen()
		row = tree.props.renderItem({ item: favorites[0] })
		buttons = nodes(row).filter((node) => node.type === 'Button')
		persist.fail()
		buttons.find((button) => button.props.title === 'versions.setDefault').props.onPress()
		assert.equal(toasts.length, 1)
		assert.equal(alerts.at(-1)[0], 'favoriteGroups.failed')
		favorites = []
		choose.props.onPress()
		assert.equal(alerts.at(-1)[0], 'versions.changed')
		assert.equal(toasts.length, 1)
	},
)
await check(
	'backup validation round-trips per-song offsets and rejects invalid collections before writing',
	() => {
		const persist = storage(),
			validator = loadModule('src/helpers/musicBackup.ts', {
				'@/store/PersistStatus': persist,
				'@/helpers/trackLyricOffset': offsets,
				'@/helpers/favoriteGroups': groups,
				'@/helpers/dislikeRules': loadModule('src/helpers/dislikeRules.ts', {}),
				'@/helpers/downloadFilename': loadModule('src/helpers/downloadFilename.ts', {
					buffer: { Buffer },
				}),
				buffer: { Buffer },
			})
		const value = offsets.withTrackLyricDelay(song(), {}, 1.5)
		persist.set('lyric.trackOffsets', value)
		const backup = validator.createMusicBackup('test')
		assert.equal(
			validator.parseMusicBackup(JSON.stringify(backup)).settings['lyric.trackOffsets'][
				'["tx","one"]'
			],
			1.5,
		)
		for (const invalid of [{ bad: 1 }, { '["tx","one"]': 30 }, []])
			assert.throws(
				() =>
					validator.parseMusicBackup(
						JSON.stringify({ ...backup, settings: { 'lyric.trackOffsets': invalid } }),
					),
				/Invalid backup setting/,
			)
		persist.set('lyric.trackOffsets', {})
		validator.restoreMusicBackup(backup, 'merge', false)
		assert.equal(Object.keys(persist.get('lyric.trackOffsets')).length, 0)
		validator.restoreMusicBackup(backup, 'merge', true)
		assert.equal(persist.get('lyric.trackOffsets')['["tx","one"]'], 1.5)
	},
)
finish()
