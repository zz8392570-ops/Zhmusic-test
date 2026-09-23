// Execute the production LX sync data owner against controlled stores.
import { assert, checks, loadModule } from './native-services-fixture.mjs'

const { check, finish } = checks()

const music = (id, extra = {}) => ({
	id,
	platform: 'tx',
	title: `Song ${id}`,
	artist: 'Artist',
	album: 'Album',
	artwork: 'https://example.test/cover.jpg',
	duration: 180,
	songmid: id,
	...extra,
})

function fixture() {
	const disk = new Map()
	let favorites = []
	let playlists = []
	let failKey
	const persist = {
		get(key) {
			return disk.has(key) ? JSON.parse(disk.get(key)) : null
		},
		set(key, value) {
			if (key === failKey) {
				failKey = undefined
				throw new Error('Storage failure')
			}
			if (value === undefined) disk.delete(key)
			else disk.set(key, JSON.stringify(value))
		},
	}
	const playListsStore = {
		getValue: () => playlists,
		setValue: (value) => {
			playlists = value
		},
	}
	const useLibraryStore = {
		getState: () => ({ favorites }),
		setState: ({ favorites: next }) => {
			favorites = next
		},
	}
	const sync = loadModule('src/helpers/sync/lxSyncData.ts', {
		'@/helpers/trackPlayerIndex': { playListsStore },
		'@/store/PersistStatus': persist,
		'@/store/library': { useLibraryStore },
	})
	return {
		...sync,
		disk,
		persist,
		failOnce: (key) => {
			failKey = key
		},
		favorites: () => favorites,
		playlists: () => playlists,
		setRawPlaylists: (value) => {
			playlists = value
		},
	}
}

const seed = (h, favorites = [], playlists = []) => {
	h.persist.set('music.favorites', favorites)
	h.persist.set('music.playLists', playlists)
	h.setLocalListData({
		defaultList: [],
		loveList: favorites.map(h.toLxMusicInfo),
		userList: playlists.map((playlist) => ({
			id: playlist.id,
			name: playlist.name,
			source: playlist.platform,
			locationUpdateTime: playlist.locationUpdateTime ?? 1,
			list: playlist.songs.map(h.toLxMusicInfo),
			cymusic: Object.fromEntries(Object.entries(playlist).filter(([key]) => key !== 'songs')),
		})),
	})
}

function credentialsFixture() {
	const legacy = new Map()
	const secure = new Map()
	const secureStore = {
		getItemAsync: async (key) => secure.get(key) ?? null,
		setItemAsync: async (key, value) => {
			secure.set(key, value)
		},
		deleteItemAsync: async (key) => {
			secure.delete(key)
		},
	}
	const persist = {
		get: (key) => legacy.get(key) ?? null,
		set: (key, value) => {
			if (value === undefined) legacy.delete(key)
			else legacy.set(key, value)
		},
	}
	return {
		...loadModule('src/helpers/sync/lxSyncCredentials.ts', {
			'@/store/PersistStatus': persist,
			'expo-secure-store': secureStore,
		}),
		legacy,
		secure,
	}
}

await check(
	'remote standard fields override stale Cymusic metadata while private fields survive',
	() => {
		const h = fixture()
		const lx = h.toLxMusicInfo(
			music('one', { title: 'Old title', artist: 'Old artist', url: 'private://stream' }),
		)
		lx.name = 'Remote title'
		lx.singer = 'Remote artist'
		lx.interval = '04:05'
		lx.meta.albumName = 'Remote album'
		lx.meta.picUrl = 'https://example.test/remote.jpg'
		const restored = h.fromLxMusicInfo(lx)
		assert.equal(restored.title, 'Remote title')
		assert.equal(restored.artist, 'Remote artist')
		assert.equal(restored.duration, 245)
		assert.equal(restored.album, 'Remote album')
		assert.equal(restored.artwork, 'https://example.test/remote.jpg')
		assert.equal(restored.url, 'private://stream')
	},
)

await check('playlist serialization is stable when legacy data has no update timestamp', () => {
	const h = fixture()
	h.setRawPlaylists([{ id: 'legacy', name: 'Legacy', songs: [music('one')] }])
	const first = JSON.stringify(h.getLocalListData())
	const second = JSON.stringify(h.getLocalListData())
	assert.equal(first, second)
	assert.equal(h.getLocalListData().userList[0].locationUpdateTime, null)
})

await check('invalid full sync data makes zero writes', () => {
	const h = fixture()
	const before = [...h.disk]
	for (const badTrack of [
		{ id: 'broken', meta: {} },
		{
			...h.toLxMusicInfo(music('bad')),
			meta: { songId: 'bad', albumName: '', _qualitys: { flac: null } },
		},
		{
			...h.toLxMusicInfo(music('bad')),
			meta: { songId: 'bad', albumName: '', cymusic: { id: 7 } },
		},
	]) {
		assert.throws(
			() =>
				h.setLocalListData({
					defaultList: [],
					loveList: [badTrack],
					userList: [],
				}),
			/Invalid sync data/,
		)
	}
	assert.deepEqual([...h.disk], before)
})

await check('a failed sync write rolls persistence and live stores back', () => {
	const h = fixture()
	seed(h, [music('old')], [{ id: 'old-list', name: 'Old', songs: [] }])
	const before = JSON.stringify([...h.disk])
	h.failOnce('music.playLists')
	assert.throws(
		() =>
			h.setLocalListData({
				defaultList: [],
				loveList: [h.toLxMusicInfo(music('new'))],
				userList: [],
			}),
		/Storage failure/,
	)
	assert.equal(JSON.stringify([...h.disk]), before)
	assert.equal(h.favorites()[0].id, 'old')
	assert.equal(h.playlists()[0].id, 'old-list')
})

await check('move and metadata update actions follow the upstream LX semantics', () => {
	const h = fixture()
	seed(
		h,
		[],
		[
			{ id: 'from', name: 'From', songs: [music('one')] },
			{ id: 'to', name: 'To', songs: [music('existing')] },
		],
	)
	const moving = h.toLxMusicInfo(music('one'))
	h.applyRemoteListAction({
		action: 'list_music_move',
		data: { fromId: 'from', toId: 'to', musicInfos: [moving], addMusicLocationType: 'top' },
	})
	assert.equal(h.playlists()[0].songs.length, 0)
	assert.deepEqual(
		Array.from(h.playlists()[1].songs, (item) => item.id),
		['one', 'existing'],
	)
	const updated = { ...moving, name: 'Updated remotely', meta: { ...moving.meta } }
	h.applyRemoteListAction({
		action: 'list_music_update',
		data: [{ id: 'to', musicInfo: updated }],
	})
	assert.equal(h.playlists()[1].songs[0].title, 'Updated remotely')
})

await check('moving into an unknown list cannot remove songs from the source', () => {
	const h = fixture()
	seed(h, [], [{ id: 'from', name: 'From', songs: [music('one')] }])
	const before = JSON.stringify([...h.disk])
	assert.throws(
		() => h.applyRemoteListAction({
			action: 'list_music_move',
			data: {
				fromId: 'from',
				toId: 'missing',
				musicInfos: [h.toLxMusicInfo(music('one'))],
				addMusicLocationType: 'top',
			},
		}),
		/Unsupported sync list/,
	)
	assert.equal(JSON.stringify([...h.disk]), before)
})

await check('unknown incremental actions fail instead of reporting a false success', () => {
	const h = fixture()
	assert.throws(
		() => h.applyRemoteListAction({ action: 'future_action', data: null }),
		/Unsupported sync action/,
	)
	assert.throws(
		() => h.applyRemoteListAction({ action: 'list_remove', data: 'playlist' }),
		/Invalid sync data/,
	)
	assert.equal(h.disk.size, 0)
})

await check('legacy pairing migrates to secure storage and clear removes both copies', async () => {
	const h = credentialsFixture()
	const credentials = {
		serverId: 'server',
		keyInfo: { clientId: 'client', key: 'secret', serverName: 'LX' },
	}
	h.legacy.set('sync.credentials', credentials)
	assert.equal(JSON.stringify(await h.getLxSyncCredentials()), JSON.stringify(credentials))
	assert.equal(h.legacy.has('sync.credentials'), false)
	assert.equal(h.secure.size, 1)
	assert.equal(JSON.stringify(await h.getLxSyncCredentials()), JSON.stringify(credentials))
	await h.clearLxSyncCredentials()
	assert.equal(await h.getLxSyncCredentials(), null)
	assert.equal(h.secure.size, 0)
})

finish()
