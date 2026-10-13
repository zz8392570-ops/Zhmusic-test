import { createFixture, item } from './file-system-fixture.mjs'
import { assert, checks, deferred, flush, loadModule } from './native-services-fixture.mjs'

const suite = checks()
const fixture = createFixture()
const edits = loadModule('src/helpers/libraryEdits.ts', {})
const importing = loadModule('src/helpers/importPlaylist.ts', {
	'@/constants/images': { unknownTrackImageUri: 'fallback' },
	'@/components/utils/musicSdk/utils': { formatSingerName: (name) => name },
	'@/helpers/libraryEdits': edits,
})
const song = (id, platform = 'kw', extra = {}) =>
	item(id, 'https://example.test/song.mp3', { platform, ...extra })
const playlist = (songs) => ({
	id: 'kw__123',
	platform: 'kw',
	title: 'Library',
	name: 'Library',
	songs,
	sourcePlaylistId: '123',
	sourceSnapshotKeys: songs.map(edits.getLibraryTrackKey),
})
const keys = (songs) => songs.map(edits.getLibraryTrackKey).join(',')

try {
	await suite.check(
		'exact deletion removes only its platform, and ambiguous legacy IDs make no writes',
		() => {
			const h = fixture.runtime()
			const facade = h.load('src/helpers/trackPlayerIndex.ts').default
			const kw = song('same'),
				wy = song('same', 'wy')
			const list = playlist([kw, wy])
			h.stores.playListsStore.setValue([list])
			assert.equal(facade.deleteSongFromStoredPlayList(list, 'same'), 'not-found-or-ambiguous')
			assert.equal(h.persistence.get('music.playLists'), null)
			assert.equal(facade.deleteSongFromStoredPlayList(list, kw), 'success')
			assert.equal(keys(h.stores.playListsStore.getValue()[0].songs), 'wy@same')
			assert.equal(keys(h.persistence.get('music.playLists')[0].songs), 'wy@same')
		},
	)
	await suite.check(
		'refresh preserves edits made while its response is pending, including clear and source replacement',
		async () => {
			const original = song('old'),
				other = song('other'),
				added = song('added', 'wy')
			for (const scenario of ['add', 'delete', 'clear', 'metadata', 'replace', 'reorder']) {
				const baseline = playlist([original, other])
				const current = { ...baseline, songs: edits.copyLibraryTracks(baseline.songs) }
				if (scenario === 'add') current.songs.push(added)
				if (scenario === 'delete') current.songs = [other]
				if (scenario === 'clear') current.songs = []
				if (scenario === 'metadata') current.songs[0].title = 'User edited'
				if (scenario === 'replace') current.songs = [song('replacement', 'tx'), other]
				if (scenario === 'reorder') current.songs.reverse()
				const remote = [song('old', 'kw', { title: 'New remote title' }), other, song('remote-new')]
				const merged = importing.mergeConcurrentImportedPlaylistRefresh(
					baseline,
					current,
					remote,
					'123',
				)
				if (scenario === 'add') assert.ok(merged.songs.some((track) => track === added))
				if (scenario === 'delete' || scenario === 'replace')
					assert.ok(!merged.songs.some((track) => track.id === 'old'))
				if (scenario === 'clear') assert.equal(merged.songs.length, 0)
				if (scenario === 'metadata') assert.equal(merged.songs[0].title, 'User edited')
				if (scenario === 'replace') assert.ok(merged.songs.some((track) => track.platform === 'tx'))
				if (scenario === 'reorder')
					assert.equal(keys(merged.songs).split(',').slice(0, 2).join(','), 'kw@other,kw@old')
			}
		},
	)
	await suite.check(
		'repair never resurrects removed songs or overwrites later edits; duplicate destinations are skipped',
		() => {
			const first = song('first'),
				second = song('second'),
				replacement = song('replacement', 'tx')
			const baseline = [first, second]
			const patches = [
				{ original: first, replacement },
				{ original: second, replacement },
			]
			assert.equal(edits.mergeLibraryRepairs(baseline, [], patches).repaired, 0)
			assert.equal(
				edits.mergeLibraryRepairs(baseline, [{ ...first, title: 'Edited' }], patches).repaired,
				0,
			)
			const merged = edits.mergeLibraryRepairs(baseline, [first, second, song('new')], patches)
			assert.equal(merged.repaired, 1)
			assert.equal(keys(merged.tracks), 'tx@replacement,kw@second,kw@new')
		},
	)
	await suite.check(
		'playlist page rebases delayed refresh and repair through the real storage updater',
		async () => {
			for (const action of ['refresh', 'repair']) {
				const pending = deferred()
				const alerts = []
				const react = {
					useState: (initial) => [initial, () => {}],
					useMemo: (fn) => fn(),
					useCallback: (fn) => fn,
					createElement: (type, props, ...children) => ({
						type,
						props: { ...props, children: children.flat() },
					}),
				}
				const h = fixture.runtime({
					moduleOverrides: {
						react,
						'@/components/utils/musicSdk': {},
						'@/components/utils/musicSdk/utils': { formatSingerName: (name) => name },
						'@/components/PlaylistTracksList': { PlaylistTracksList: 'Playlist' },
						'@/styles': { useDefaultStyles: () => ({}) },
						'@/helpers/playlistFile': { serializePlaylistFile() {} },
						'expo-router': {
							Redirect: 'Redirect',
							useLocalSearchParams: () => ({ name: 'kw__123' }),
						},
						'expo-file-system': { File: class {}, Paths: {} },
						'react-native': {
							View: 'View',
							ScrollView: 'Scroll',
							Alert: { alert: (...args) => alerts.push(args) },
						},
						'@/helpers/importPlaylist': {
							...importing,
							fetchImportedPlaylistSongs: () => pending.promise,
						},
						'@/helpers/libraryRepair': { repairUnavailableTracks: () => pending.promise },
						'@/helpers/crossPlatformSearch': { searchSongsAcrossPlatforms: async () => [] },
						'@/../modules/cymusic-native/sharing': { shareLocalFiles() {} },
					},
				})
				const facade = h.load('src/helpers/trackPlayerIndex.ts').default
				const first = song('first'),
					second = song('second')
				h.stores.playListsStore.setValue([playlist([first, second])])
				const Screen = h.load('src/app/(tabs)/favorites/[name].tsx').default
				const find = (node) =>
					node?.type === 'Playlist' ? node : node?.props?.children?.map(find).find(Boolean)
				const props = find(Screen()).props
				props.onManagementAction(action)
				await flush()
				assert.equal(
					facade.updateStoredPlaylist('kw__123', {
						songs: [{ ...second, title: 'Manual change' }, song('added')],
					}),
					'success',
				)
				pending.resolve(
					action === 'refresh'
						? { songs: [first, second, song('remote')], sourcePlaylistId: '123' }
						: {
								repaired: 2,
								unavailable: 2,
								review: [],
								replacements: [
									{ original: first, replacement: song('replacement', 'tx') },
									{ original: second, replacement: song('other-replacement', 'tx') },
								],
							},
				)
				await flush()
				const live = h.stores.playListsStore.getValue()[0].songs
				assert.ok(!live.some((track) => track.id === 'first'))
				assert.ok(live.some((track) => track.id === 'added'))
				assert.equal(live.find((track) => track.id === 'second').title, 'Manual change')
				assert.ok(alerts.length)
				assert.equal(keys(h.persistence.get('music.playLists')[0].songs), keys(live))
			}
		},
	)
} finally {
	await fixture.dispose()
	suite.finish()
}
