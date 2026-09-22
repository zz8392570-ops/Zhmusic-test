import { playListsStore } from '@/helpers/trackPlayerIndex'
import PersistStatus from '@/store/PersistStatus'
import { useLibraryStore } from '@/store/library'
import type { LxListAction, LxListData, LxMusicInfo, LxUserList } from './lxSyncTypes'

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
						...(typeof (quality as any)?.hash === 'string'
							? { hash: (quality as any).hash }
							: {}),
					},
				]),
			),
			cymusic: track,
		},
	}
}

export const fromLxMusicInfo = (track: LxMusicInfo): IMusic.IMusicItem => {
	const saved = track.meta?.cymusic
	if (saved) return saved
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
		id: songId,
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
		qualities: qualities as IMusic.IQuality,
	}
}

const toLxUserList = (playlist: IMusic.PlayList): LxUserList => {
	const metadata = Object.fromEntries(
		Object.entries(playlist).filter(([key]) => key !== 'songs'),
	) as Omit<IMusic.PlayList, 'songs'>
	return {
		id: String(playlist.id),
		name: playlist.name || playlist.title || '',
		source: playlist.platform || undefined,
		sourceListId: typeof playlist.sourceListId === 'string' ? playlist.sourceListId : undefined,
		locationUpdateTime:
			typeof playlist.locationUpdateTime === 'number' ? playlist.locationUpdateTime : Date.now(),
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
	const favorites = Array.isArray(data.loveList) ? data.loveList.map(fromLxMusicInfo) : []
	const playlists = Array.isArray(data.userList) ? data.userList.map(fromLxUserList) : []
	PersistStatus.set('music.favorites', favorites)
	PersistStatus.set('music.playLists', playlists)
	useLibraryStore.setState({ favorites })
	playListsStore.setValue(playlists)
}

export const applyRemoteListAction = (action: LxListAction) => {
	const current = getLocalListData()
	const data = action.data
	switch (action.action) {
		case 'list_data_overwrite':
			setLocalListData(data as LxListData)
			return
		case 'list_create':
			current.userList.splice(data.position, 0, ...data.listInfos.map((item: any) => ({ ...item, list: [] })))
			break
		case 'list_remove':
			current.userList = current.userList.filter((item) => !data.includes(item.id))
			break
		case 'list_update':
			for (const patch of data) {
				const index = current.userList.findIndex((item) => item.id === patch.id)
				if (index >= 0) current.userList[index] = { ...current.userList[index], ...patch }
			}
			break
		case 'list_update_position': {
			const moving = data.ids
				.map((id: string) => current.userList.find((item) => item.id === id))
				.filter(Boolean) as LxUserList[]
			current.userList = current.userList.filter((item) => !data.ids.includes(item.id))
			current.userList.splice(data.position, 0, ...moving)
			break
		}
		case 'list_music_overwrite':
			updateList(current, data.listId, () => data.musicInfos)
			break
		case 'list_music_add':
			updateList(current, data.id, (list) =>
				data.addMusicLocationType === 'top' ? [...data.musicInfos, ...list] : [...list, ...data.musicInfos],
			)
			break
		case 'list_music_remove':
			updateList(current, data.listId, (list) => list.filter((item) => !data.ids.includes(item.id)))
			break
		case 'list_music_clear':
			for (const id of data) updateList(current, id, () => [])
			break
		case 'list_music_update_position':
			updateList(current, data.listId, (list) => {
				const moving = data.ids
					.map((id: string) => list.find((item) => item.id === id))
					.filter(Boolean) as LxMusicInfo[]
				const next = list.filter((item) => !data.ids.includes(item.id))
				next.splice(data.position, 0, ...moving)
				return next
			})
			break
		default:
			return
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
		if (playlist) playlist.list = update(playlist.list)
	}
}
