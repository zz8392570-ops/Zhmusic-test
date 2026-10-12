import { fromLxMusicInfo, toLxMusicInfo } from '@/helpers/sync/lxSyncData'
import type { LxMusicInfo } from '@/helpers/sync/lxSyncTypes'
import { Buffer } from 'buffer'

export const MAX_PLAYLIST_FILE_BYTES = 10 * 1024 * 1024
const MAX_PLAYLIST_TRACKS = 50_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value)

const validLxTrack = (value: unknown): value is LxMusicInfo =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	!!value.id &&
	typeof value.name === 'string' &&
	typeof value.singer === 'string' &&
	typeof value.source === 'string' &&
	(value.interval === null || typeof value.interval === 'string') &&
	isRecord(value.meta) &&
	(typeof value.meta.songId === 'string' ||
		(typeof value.meta.songId === 'number' && Number.isFinite(value.meta.songId))) &&
	typeof value.meta.albumName === 'string'

const safeMetadata = (playlist: IMusic.PlayList) =>
	Object.fromEntries(
		Object.entries(playlist).filter(
			([key, value]) => key !== 'songs' && value !== undefined && typeof value !== 'function',
		),
	)

/** Build LX Music's current single-playlist format while retaining Cymusic-only metadata. */
export const createPlaylistFile = (playlist: IMusic.PlayList) => ({
	type: 'playListPart_v2' as const,
	data: {
		id: String(playlist.id),
		name: playlist.name || playlist.title || '',
		source: playlist.platform || undefined,
		sourceListId:
			typeof playlist.sourcePlaylistId === 'string'
				? playlist.sourcePlaylistId
				: typeof playlist.sourceListId === 'string'
					? playlist.sourceListId
					: undefined,
		locationUpdateTime:
			typeof playlist.locationUpdateTime === 'number' ? playlist.locationUpdateTime : null,
		list: (playlist.songs ?? []).map(toLxMusicInfo),
		cymusic: safeMetadata(playlist),
	},
})

export const serializePlaylistFile = (playlist: IMusic.PlayList) =>
	JSON.stringify(createPlaylistFile(playlist), null, 2)

export const parsePlaylistFile = (text: string): IMusic.PlayList => {
	if (Buffer.byteLength(text, 'utf8') > MAX_PLAYLIST_FILE_BYTES)
		throw new Error('Playlist file exceeds size limit')
	const value: unknown = JSON.parse(text)
	if (!isRecord(value) || value.type !== 'playListPart_v2' || !isRecord(value.data))
		throw new Error('Unsupported playlist file')
	const data = value.data
	if (
		typeof data.name !== 'string' ||
		!data.name.trim() ||
		!Array.isArray(data.list) ||
		data.list.length > MAX_PLAYLIST_TRACKS ||
		!data.list.every(validLxTrack)
	)
		throw new Error('Invalid playlist file')
	const metadata = isRecord(data.cymusic) ? data.cymusic : {}
	const songs = data.list.map(fromLxMusicInfo)
	const id = typeof data.id === 'string' && data.id ? data.id : `lx_${Date.now()}`
	const name = data.name.trim()
	return {
		...metadata,
		id,
		platform:
			typeof metadata.platform === 'string'
				? metadata.platform
				: typeof data.source === 'string'
					? data.source
					: 'lx',
		artist: typeof metadata.artist === 'string' ? metadata.artist : '',
		title: typeof metadata.title === 'string' && metadata.title ? metadata.title : name,
		name,
		artwork:
			typeof metadata.artwork === 'string'
				? metadata.artwork
				: songs.find((song) => !!song.artwork)?.artwork || '',
		sourceListId: typeof data.sourceListId === 'string' ? data.sourceListId : undefined,
		sourcePlaylistId: typeof data.sourceListId === 'string' ? data.sourceListId : undefined,
		locationUpdateTime:
			typeof data.locationUpdateTime === 'number' && Number.isFinite(data.locationUpdateTime)
				? data.locationUpdateTime
				: null,
		songs,
	} as IMusic.PlayList
}

export const uniqueImportedPlaylist = (
	playlist: IMusic.PlayList,
	existing: IMusic.PlayList[],
): IMusic.PlayList => {
	if (!existing.some((item) => item.id === playlist.id)) return playlist
	const suffix = Date.now().toString(36)
	return { ...playlist, id: `${playlist.id}_${suffix}` }
}
