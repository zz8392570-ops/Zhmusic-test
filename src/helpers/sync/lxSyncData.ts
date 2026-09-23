import { playListsStore } from '@/helpers/trackPlayerIndex'
import PersistStatus from '@/store/PersistStatus'
import { useLibraryStore } from '@/store/library'
import type { LxListAction, LxListData, LxMusicInfo, LxUserList } from './lxSyncTypes'

const MAX_SYNC_TRACKS = 50_000
const MAX_SYNC_PLAYLISTS = 1_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value)

const invalidSyncData = () => new Error('Invalid sync data')

const validSavedTrack = (value: unknown) =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	!!value.id &&
	typeof value.platform === 'string' &&
	typeof value.title === 'string' &&
	typeof value.artist === 'string'

const validQualities = (value: unknown) =>
	isRecord(value) &&
	Object.values(value).every(
		(quality) =>
			isRecord(quality) &&
			(quality.size === null || typeof quality.size === 'string') &&
			(quality.hash === undefined || typeof quality.hash === 'string'),
	)

const validateMusicInfo = (value: unknown): value is LxMusicInfo => {
	if (
		!isRecord(value) ||
		typeof value.id !== 'string' ||
		!value.id ||
		typeof value.name !== 'string' ||
		typeof value.singer !== 'string' ||
		typeof value.source !== 'string' ||
		(value.interval !== null && typeof value.interval !== 'string') ||
		!isRecord(value.meta) ||
		(typeof value.meta.songId !== 'string' &&
			(typeof value.meta.songId !== 'number' || !Number.isFinite(value.meta.songId))) ||
		typeof value.meta.albumName !== 'string'
	)
		return false
	if (value.meta.cymusic !== undefined && !validSavedTrack(value.meta.cymusic)) return false
	if (value.meta._qualitys !== undefined && !validQualities(value.meta._qualitys)) return false
	if (
		value.meta.qualitys !== undefined &&
		(!Array.isArray(value.meta.qualitys) ||
			!value.meta.qualitys.every(
				(quality) =>
					isRecord(quality) &&
					typeof quality.type === 'string' &&
					(quality.size === null || typeof quality.size === 'string'),
			))
	)
		return false
	return true
}

const validateMusicList = (value: unknown): value is LxMusicInfo[] =>
	Array.isArray(value) && value.length <= MAX_SYNC_TRACKS && value.every(validateMusicInfo)

export const validateLxListData = (value: unknown): LxListData => {
	if (
		!isRecord(value) ||
		!validateMusicList(value.defaultList) ||
		!validateMusicList(value.loveList) ||
		!Array.isArray(value.userList) ||
		value.userList.length > MAX_SYNC_PLAYLISTS
	)
		throw invalidSyncData()
	let trackCount = value.defaultList.length + value.loveList.length
	if (trackCount > MAX_SYNC_TRACKS) throw invalidSyncData()
	const ids = new Set<string>()
	for (const playlist of value.userList) {
		if (
			!isRecord(playlist) ||
			typeof playlist.id !== 'string' ||
			!playlist.id ||
			ids.has(playlist.id) ||
			typeof playlist.name !== 'string' ||
			(playlist.locationUpdateTime !== null &&
				(typeof playlist.locationUpdateTime !== 'number' ||
					!Number.isFinite(playlist.locationUpdateTime))) ||
			!validateMusicList(playlist.list) ||
			(playlist.cymusic !== undefined && !isRecord(playlist.cymusic))
		)
			throw invalidSyncData()
		ids.add(playlist.id)
		trackCount += playlist.list.length
		if (trackCount > MAX_SYNC_TRACKS) throw invalidSyncData()
	}
	return value as unknown as LxListData
}

const validStringArray = (value: unknown) =>
	Array.isArray(value) && value.every((item) => typeof item === 'string' && !!item)

const validPosition = (value: unknown) =>
	typeof value === 'number' && Number.isInteger(value) && value >= 0

const validateLxListAction = (value: unknown): LxListAction => {
	if (!isRecord(value) || typeof value.action !== 'string') throw invalidSyncData()
	const data = value.data
	switch (value.action) {
		case 'list_data_overwrite':
			validateLxListData(data)
			break
		case 'list_create':
			if (
				!isRecord(data) ||
				!validPosition(data.position) ||
				!Array.isArray(data.listInfos) ||
				data.listInfos.length > MAX_SYNC_PLAYLISTS ||
				!data.listInfos.every(
					(item) => isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string',
				)
			)
				throw invalidSyncData()
			break
		case 'list_remove':
		case 'list_music_clear':
			if (!validStringArray(data)) throw invalidSyncData()
			break
		case 'list_update':
			if (
				!Array.isArray(data) ||
				!data.every((item) => isRecord(item) && typeof item.id === 'string' && !!item.id)
			)
				throw invalidSyncData()
			break
		case 'list_update_position':
			if (!isRecord(data) || !validPosition(data.position) || !validStringArray(data.ids))
				throw invalidSyncData()
			break
		case 'list_music_add':
			if (
				!isRecord(data) ||
				typeof data.id !== 'string' ||
				!validateMusicList(data.musicInfos) ||
				!['top', 'bottom'].includes(String(data.addMusicLocationType))
			)
				throw invalidSyncData()
			break
		case 'list_music_move':
			if (
				!isRecord(data) ||
				typeof data.fromId !== 'string' ||
				typeof data.toId !== 'string' ||
				!validateMusicList(data.musicInfos) ||
				!['top', 'bottom'].includes(String(data.addMusicLocationType))
			)
				throw invalidSyncData()
			break
		case 'list_music_remove':
			if (!isRecord(data) || typeof data.listId !== 'string' || !validStringArray(data.ids))
				throw invalidSyncData()
			break
		case 'list_music_update':
			if (
				!Array.isArray(data) ||
				!data.every(
					(item) =>
						isRecord(item) &&
						typeof item.id === 'string' &&
						!!item.id &&
						validateMusicInfo(item.musicInfo),
				)
			)
				throw invalidSyncData()
			break
		case 'list_music_update_position':
			if (
				!isRecord(data) ||
				typeof data.listId !== 'string' ||
				!validPosition(data.position) ||
				!validStringArray(data.ids)
			)
				throw invalidSyncData()
			break
		case 'list_music_overwrite':
			if (!isRecord(data) || typeof data.listId !== 'string' || !validateMusicList(data.musicInfos))
				throw invalidSyncData()
			break
		default:
			throw new Error('Unsupported sync action')
	}
	return value as unknown as LxListAction
}

const formatInterval = (seconds: number) => {
	if (!Number.isFinite(seconds) || seconds <= 0) return null
	const minutes = Math.floor(seconds / 60)
	const remainder = Math.floor(seconds % 60)
	return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

const parseInterval = (interval: string | null) => {
	if (!interval) return 0
	const parts = interval.split(':').map(Number)
	if (parts.some((part) => !Number.isFinite(part))) return 0
	return parts.reduce((total, part) => total * 60 + part, 0)
}

export const toLxMusicInfo = (track: IMusic.IMusicItem): LxMusicInfo => {
	const source = track.platform || 'local'
	const songId = String(track.songmid ?? track.id)
	const hash = typeof track.hash === 'string' ? track.hash : undefined
	return {
		id: source === 'kg' && hash ? `${songId}_${hash}` : `${source}_${songId}`,
		name: track.title || '',
		singer: track.artist || '',
		source,
		interval: formatInterval(track.duration),
		meta: {
			songId,
			albumName: track.album || '',
			picUrl: track.artwork || null,
			albumId: track.albumid ?? track.albumId,
			albumMid: track.albummid ?? track.albumMid,
			strMediaMid: track.strMediaMid,
			hash,
			copyrightId: track.copyrightId,
			lrcUrl: track.lrcUrl,
			mrcUrl: track.mrcUrl,
			trcUrl: track.trcUrl,
			qualitys: Object.entries(track.qualities ?? {}).map(([type, quality]) => ({
				type,
				size: quality?.size == null ? null : String(quality.size),
			})),
			_qualitys: Object.fromEntries(
				Object.entries(track.qualities ?? {}).map(([type, quality]) => [
					type,
					{
						size: quality?.size == null ? null : String(quality.size),
						...(typeof (quality as any)?.hash === 'string' ? { hash: (quality as any).hash } : {}),
					},
				]),
			),
			cymusic: track,
		},
	}
}

export const fromLxMusicInfo = (track: LxMusicInfo): IMusic.IMusicItem => {
	const saved = track.meta?.cymusic
	const songId = String(track.meta?.songId ?? track.id)
	const qualities = Object.fromEntries(
		Object.entries(track.meta?._qualitys ?? {}).map(([type, quality]) => [
			type,
			{
				size: quality.size ?? undefined,
				...(typeof quality.hash === 'string' ? { hash: quality.hash } : {}),
			},
		]),
	)
	return {
		...(saved ?? {}),
		id: saved?.id ?? songId,
		platform: track.source ?? 'local',
		artist: track.singer ?? '',
		title: track.name ?? '',
		duration: parseInterval(track.interval),
		album: track.meta?.albumName ?? '',
		artwork: track.meta?.picUrl ?? '',
		songmid: songId,
		albumid:
			typeof track.meta?.albumId === 'string' || typeof track.meta?.albumId === 'number'
				? track.meta.albumId
				: undefined,
		albummid: typeof track.meta?.albumMid === 'string' ? track.meta.albumMid : undefined,
		albumId: track.meta?.albumId,
		albumMid: track.meta?.albumMid,
		strMediaMid: track.meta?.strMediaMid,
		hash: track.meta?.hash,
		copyrightId: track.meta?.copyrightId,
		lrcUrl: track.meta?.lrcUrl,
		mrcUrl: track.meta?.mrcUrl,
		trcUrl: track.meta?.trcUrl,
		qualities:
			Object.keys(qualities).length > 0 ? (qualities as IMusic.IQuality) : saved?.qualities,
	}
}

const toLxUserList = (playlist: IMusic.PlayList): LxUserList => {
	const metadata = Object.fromEntries(
		Object.entries(playlist).filter(
			([key]) => !['songs', 'folder', 'pinned', 'sortOrder'].includes(key),
		),
	) as Omit<IMusic.PlayList, 'songs'>
	return {
		id: String(playlist.id),
		name: playlist.name || playlist.title || '',
		source: playlist.platform || undefined,
		sourceListId: typeof playlist.sourceListId === 'string' ? playlist.sourceListId : undefined,
		locationUpdateTime:
			typeof playlist.locationUpdateTime === 'number' ? playlist.locationUpdateTime : null,
		list: (playlist.songs ?? []).map(toLxMusicInfo),
		cymusic: metadata,
	}
}

const fromLxUserList = (playlist: LxUserList): IMusic.PlayList => ({
	...(playlist.cymusic ?? {}),
	id: String(playlist.id),
	platform: playlist.cymusic?.platform ?? playlist.source ?? 'lx',
	artist: playlist.cymusic?.artist ?? '',
	title: playlist.cymusic?.title ?? playlist.name,
	name: playlist.name,
	artwork: playlist.cymusic?.artwork ?? playlist.list[0]?.meta?.picUrl ?? '',
	sourceListId: playlist.sourceListId,
	locationUpdateTime: playlist.locationUpdateTime,
	songs: playlist.list.map(fromLxMusicInfo),
})

export const getLocalListData = (): LxListData => ({
	defaultList: [],
	loveList: useLibraryStore.getState().favorites.map(toLxMusicInfo),
	userList: (playListsStore.getValue() ?? []).map(toLxUserList),
})

export const setLocalListData = (data: LxListData) => {
	data = validateLxListData(data)
	const favorites = data.loveList.map(fromLxMusicInfo)
	const localOrganization = new Map(
		(playListsStore.getValue() ?? []).map((playlist) => [
			playlist.id,
			{
				folder: playlist.folder,
				pinned: playlist.pinned,
				sortOrder: playlist.sortOrder,
			},
		]),
	)
	const playlists = data.userList.map((item) => {
		const playlist = fromLxUserList(item)
		return { ...playlist, ...(localOrganization.get(playlist.id) ?? {}) }
	})
	const previousFavorites = PersistStatus.get('music.favorites')
	const previousPlaylists = PersistStatus.get('music.playLists')
	const previousLibraryFavorites = useLibraryStore.getState().favorites
	const previousPlaylistValue = playListsStore.getValue()
	try {
		PersistStatus.set('music.favorites', favorites)
		PersistStatus.set('music.playLists', playlists)
		useLibraryStore.setState({ favorites })
		playListsStore.setValue(playlists)
	} catch (error) {
		try {
			PersistStatus.set('music.favorites', previousFavorites ?? undefined)
			PersistStatus.set('music.playLists', previousPlaylists ?? undefined)
		} catch {
			/* Best effort if storage itself remains unavailable. */
		}
		try {
			useLibraryStore.setState({ favorites: previousLibraryFavorites })
			playListsStore.setValue(previousPlaylistValue ?? [])
		} catch {
			/* Best effort if an in-memory subscriber remains unavailable. */
		}
		throw error
	}
}

export const applyRemoteListAction = (value: unknown) => {
	const action = validateLxListAction(value)
	const current = getLocalListData()
	switch (action.action) {
		case 'list_data_overwrite':
			setLocalListData(action.data)
			return
		case 'list_create':
			current.userList.splice(
				action.data.position,
				0,
				...action.data.listInfos.map((item) => ({ ...item, list: [] })),
			)
			break
		case 'list_remove':
			current.userList = current.userList.filter((item) => !action.data.includes(item.id))
			break
		case 'list_update':
			for (const patch of action.data) {
				const index = current.userList.findIndex((item) => item.id === patch.id)
				if (index >= 0) current.userList[index] = { ...current.userList[index], ...patch }
			}
			break
		case 'list_update_position': {
			const moving = action.data.ids
				.map((id: string) => current.userList.find((item) => item.id === id))
				.filter(Boolean) as LxUserList[]
			current.userList = current.userList.filter((item) => !action.data.ids.includes(item.id))
			current.userList.splice(action.data.position, 0, ...moving)
			break
		}
		case 'list_music_overwrite':
			updateList(current, action.data.listId, () => action.data.musicInfos)
			break
		case 'list_music_add':
			updateList(current, action.data.id, (list) =>
				action.data.addMusicLocationType === 'top'
					? [...action.data.musicInfos, ...list]
					: [...list, ...action.data.musicInfos],
			)
			break
		case 'list_music_move': {
			if (!hasList(current, action.data.fromId) || !hasList(current, action.data.toId))
				throw new Error('Unsupported sync list')
			const movingIds = new Set(action.data.musicInfos.map((item: LxMusicInfo) => item.id))
			if (action.data.fromId === action.data.toId) {
				updateList(current, action.data.fromId, (list) => {
					const remaining = list.filter((item) => !movingIds.has(item.id))
					return action.data.addMusicLocationType === 'top'
						? [...action.data.musicInfos, ...remaining]
						: [...remaining, ...action.data.musicInfos]
				})
			} else {
				updateList(current, action.data.fromId, (list) =>
					list.filter((item) => !movingIds.has(item.id)),
				)
				updateList(current, action.data.toId, (list) =>
					action.data.addMusicLocationType === 'top'
						? [...action.data.musicInfos, ...list]
						: [...list, ...action.data.musicInfos],
				)
			}
			break
		}
		case 'list_music_remove':
			updateList(current, action.data.listId, (list) =>
				list.filter((item) => !action.data.ids.includes(item.id)),
			)
			break
		case 'list_music_update':
			for (const update of action.data) {
				updateList(current, update.id, (list) =>
					list.map((item) => (item.id === update.musicInfo.id ? update.musicInfo : item)),
				)
			}
			break
		case 'list_music_clear':
			for (const id of action.data) updateList(current, id, () => [])
			break
		case 'list_music_update_position':
			updateList(current, action.data.listId, (list) => {
				const moving = action.data.ids
					.map((id: string) => list.find((item) => item.id === id))
					.filter(Boolean) as LxMusicInfo[]
				const next = list.filter((item) => !action.data.ids.includes(item.id))
				next.splice(action.data.position, 0, ...moving)
				return next
			})
			break
		default:
			throw new Error('Unsupported sync action')
	}
	setLocalListData(current)
}

const updateList = (
	data: LxListData,
	listId: string,
	update: (list: LxMusicInfo[]) => LxMusicInfo[],
) => {
	if (listId === 'love') data.loveList = update(data.loveList)
	else {
		const playlist = data.userList.find((item) => item.id === listId)
		if (!playlist) throw new Error('Unsupported sync list')
		playlist.list = update(playlist.list)
	}
}

const hasList = (data: LxListData, listId: string) =>
	listId === 'love' || data.userList.some((playlist) => playlist.id === listId)
