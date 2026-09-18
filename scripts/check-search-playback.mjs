import { assert, loadModule } from './native-services-fixture.mjs'

// Exercise the actual search formatter with both QQ response formats.
const modern = {
	id: 123456789,
	mid: '001SongMid',
	title: '人生路漫漫',
	singer: [{ name: '歌手甲' }, { name: '歌手乙' }],
	album: { id: 42, mid: '001AlbumMid', title: '专辑' },
	interval: 208,
	file: {
		media_mid: '001MediaMid',
		size_128mp3: 3000000,
		size_320mp3: 8000000,
		size_flac: 24000000,
	},
}
const legacy = {
	songid: 987654321,
	songmid: '002SongMid',
	songname: '旧格式',
	singer: [],
	albumid: 43,
	albummid: '002AlbumMid',
	albumname: '旧专辑',
}
const search = loadModule('src/helpers/userApi/xiaoqiu.js', {
	axios: {
		default: async () => ({
			data: { req_1: { data: { meta: { sum: 2 }, body: { song: { list: [modern, legacy] } } } } },
		}),
	},
	'crypto-js': {},
})
const result = await search.searchMusic('人生路漫漫', 1, 20)
const [track, old] = result.data
assert.equal(track.id, modern.mid)
assert.equal(
	track.songmid,
	modern.mid,
	'Audio scripts must receive the string MID rather than numeric song ID',
)
assert.equal(track.songId, modern.id)
assert.equal(track.strMediaMid, modern.file.media_mid)
assert.equal(track.duration, 208)
assert.equal(track.artist, '歌手甲、歌手乙')
assert.deepEqual(Object.keys(track.qualities).sort(), ['128k', '320k', 'flac'])
assert.equal(old.id, legacy.songmid)
assert.equal(old.songmid, legacy.songmid)
assert.equal(old.songId, legacy.songid)
assert.equal(old.strMediaMid, legacy.songmid)
assert.equal(result.isEnd, true)
console.log(
	'PASS: QQ search preserves playback MID, numeric ID, media MID and quality fields for modern and legacy responses',
)
