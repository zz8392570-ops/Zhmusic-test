import { Buffer } from 'node:buffer'
import { assert, checks, loadModule } from './native-services-fixture.mjs'

const { check, finish } = checks()
const toLxMusicInfo = (track) => ({
	id: `${track.platform}_${track.id}`,
	name: track.title,
	singer: track.artist,
	source: track.platform,
	interval: '03:00',
	meta: { songId: track.id, albumName: track.album, cymusic: track },
})
const fromLxMusicInfo = (track) => ({
	...track.meta.cymusic,
	id: String(track.meta.songId),
	platform: track.source,
	title: track.name,
	artist: track.singer,
	album: track.meta.albumName,
	duration: 180,
	artwork: track.meta.cymusic?.artwork ?? '',
})
const files = loadModule('src/helpers/playlistFile.ts', {
	'@/helpers/sync/lxSyncData': { toLxMusicInfo, fromLxMusicInfo },
	buffer: { Buffer },
})
const organizer = loadModule('src/helpers/playlistOrganizer.ts', {})
const track = (id, title, artist = 'Artist') => ({
	id,
	platform: 'tx',
	title,
	artist,
	album: 'Album',
	duration: 180,
	artwork: '',
})

await check('single-playlist export stays LX v2 compatible and roundtrips Cymusic metadata', () => {
	const playlist = {
		id: 'mine',
		name: 'My list',
		title: 'My list',
		platform: 'tx',
		artist: '',
		artwork: 'cover',
		folder: 'Road',
		pinned: true,
		songs: [track('1', 'One')],
	}
	const raw = files.serializePlaylistFile(playlist)
	const serialized = JSON.parse(raw)
	assert.equal(serialized.type, 'playListPart_v2')
	assert.equal(serialized.data.list[0].name, 'One')
	const restored = files.parsePlaylistFile(raw)
	assert.equal(restored.name, 'My list')
	assert.equal(restored.folder, 'Road')
	assert.equal(restored.pinned, true)
	assert.equal(restored.songs[0].id, '1')
})

await check(
	'playlist import rejects unsupported and oversized files and avoids ID collisions',
	() => {
		assert.throws(() => files.parsePlaylistFile('{}'), /Unsupported/)
		assert.throws(
			() => files.parsePlaylistFile('x'.repeat(files.MAX_PLAYLIST_FILE_BYTES + 1)),
			/size limit/,
		)
		const playlist = { id: 'same', name: 'Same', title: 'Same', songs: [] }
		assert.equal(files.uniqueImportedPlaylist(playlist, []).id, 'same')
		assert.match(files.uniqueImportedPlaylist(playlist, [playlist]).id, /^same_/)
	},
)

await check(
	'playlist sorting supports ascending and descending while retaining stable ties',
	() => {
		const tracks = [track('1', 'Beta'), track('2', 'Alpha'), track('3', 'Alpha')]
		assert.deepEqual(
			organizer.sortPlaylistTracks(tracks, 'title', 'asc').map((item) => item.id),
			['2', '3', '1'],
		)
		assert.deepEqual(
			organizer.sortPlaylistTracks(tracks, 'title', 'desc').map((item) => item.id),
			['1', '2', '3'],
		)
	},
)

finish()
