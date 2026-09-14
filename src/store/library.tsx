import { Artist, Playlist, TrackWithPlaylist } from '@/helpers/types'
import {
	DEFAULT_HOME_BOARD_ID,
	DEFAULT_HOME_SOURCE,
	getBoardSongs,
	getLeaderboardBoardName,
	getLeaderboardBoards,
	mapLeaderboardTrack,
	normalizeBoardId,
	normalizeLeaderboardSource,
	resolveBoardId,
	type LeaderboardSource,
} from '@/helpers/leaderboard'
import { useEffect, useRef } from 'react'
import type { Track } from '@/player/types'
import { create } from 'zustand'

import { getTopLists } from '@/helpers/userApi/getMusicSource'
import PersistStatus from '@/store/PersistStatus'
import { isSameMediaItem } from '@/utils/mediaItem'

export { DEFAULT_HOME_BOARD_ID, DEFAULT_HOME_SOURCE }

export const getHomeBoards = (source?: LeaderboardSource) => {
	const resolvedSource = normalizeLeaderboardSource(
		source ?? PersistStatus.get('music.homeBoardSource') ?? DEFAULT_HOME_SOURCE,
	)
	return getLeaderboardBoards(resolvedSource)
}

export const getHomeBoardName = (id?: number | string | null, source?: LeaderboardSource) => {
	const resolvedSource = normalizeLeaderboardSource(
		source ?? PersistStatus.get('music.homeBoardSource') ?? DEFAULT_HOME_SOURCE,
	)
	return getLeaderboardBoardName(resolvedSource, id)
}

interface LibraryState {
	allTracks: TrackWithPlaylist[]
	tracks: TrackWithPlaylist[]
	favorites: IMusic.IMusicItem[]
	nowLyric: string
	playlists: Playlist[]
	isLoading: boolean
	isRefreshing: boolean
	error: string | null
	toggleTrackFavorite: (track: Track) => void
	addToPlaylist: (track: Track, playlistName: string) => void
	fetchTracks: (refresh?: boolean, homeBoardId?: string | number) => Promise<void>
	setNowLyric: (lyric: string) => void
	setPlayList: () => void
	page: number
	hasMore: boolean
	// getMusicIndex: (musicItem?: IMusic.IMusicItem | null) => number
	// isInPlayList: (musicItem?: IMusic.IMusicItem | null) => boolean
	// getPlayListMusicAt: (index: number) => IMusic.IMusicItem | null
	// isPlayListEmpty: () => boolean
}

let homeBoardRequestId = 0
export const useLibraryStore = create<LibraryState>((set, get) => ({
	allTracks: [],
	tracks: [],
	isLoading: false,
	isRefreshing: false,
	error: null,
	page: 1,
	hasMore: true,
	favorites: PersistStatus.get('music.favorites') || [],
	nowLyric: '当前无歌词',
	playlists: [],
	toggleTrackFavorite: (track: Track) => {
		set((state) => {
			const favorites = [...state.favorites]
			const index = favorites.findIndex((favorite) =>
				isSameMediaItem(favorite, track as IMusic.IMusicItem),
			)

			if (index !== -1) {
				// 如果存在，则从数组中删除
				favorites.splice(index, 1)
			} else {
				// 如果不存在，则添加到数组中
				favorites.push(track as IMusic.IMusicItem)
			}
			// 更新持久化存储中的favorites
			PersistStatus.set('music.favorites', favorites)

			// 返回新的状态
			return { favorites }
		})
	},
	addToPlaylist: (track, playlistName) =>
		set((state) => ({
			tracks: state.tracks.map((currentTrack) => {
				if (currentTrack.url === track.url) {
					return {
						...currentTrack,
						playlist: [...(currentTrack.playlist ?? []), playlistName],
					}
				}
				return currentTrack
			}),
		})),
	fetchTracks: async (refresh = false, requestedHomeBoardId) => {
		const { page, hasMore, isLoading, allTracks } = get()
		if (!refresh && (isLoading || !hasMore)) return
		const PAGE_SIZE = 100
		const needsBoardRequest = refresh || allTracks.length === 0
		const requestId = needsBoardRequest ? ++homeBoardRequestId : homeBoardRequestId

		try {
			if (needsBoardRequest) {
				// 只在刷新或首次加载时请求数据
				set({
					isLoading: true,
					isRefreshing: refresh,
					error: null,
					...(refresh ? { page: 1, hasMore: true } : {}),
				})
				const source = normalizeLeaderboardSource(
					PersistStatus.get('music.homeBoardSource') ?? DEFAULT_HOME_SOURCE,
				)
				const homeBoardId = resolveBoardId(
					source,
					requestedHomeBoardId ?? PersistStatus.get('music.homeBoardId') ?? DEFAULT_HOME_BOARD_ID,
				)
				const data = await getBoardSongs(source, homeBoardId, 1)
				if (requestId !== homeBoardRequestId) return
				const mappedTracks = data.list.map((track) => mapLeaderboardTrack(track, source))
				// console.log(mappedTracks.length)
				set({ allTracks: mappedTracks })
			}
			if (requestId !== homeBoardRequestId) return
			set({ isLoading: true })
			// // 延时
			// await new Promise((resolve) => setTimeout(resolve, 5000))
			// console.log(isLoading)
			const currentPage = refresh ? 1 : page
			const start = (currentPage - 1) * PAGE_SIZE
			const end = start + PAGE_SIZE
			const newTracks = get().allTracks.slice(start, end)

			set((state) => ({
				tracks: refresh ? newTracks : [...state.tracks, ...newTracks],
				page: currentPage + 1,
				hasMore: end < get().allTracks.length,
				isLoading: false,
				isRefreshing: false,
				error: null,
			}))
		} catch (error) {
			console.error('Failed to fetch tracks:', error)
			if (requestId === homeBoardRequestId) {
				set({ isLoading: false, isRefreshing: false, error: 'load-failed' })
			}
		}
	},
	setNowLyric: (nowLyric: string) => {
		set({ nowLyric: nowLyric })
	},
	setPlayList: async () => {
		try {
			const playlists = await getTopLists()
			const combinedData = playlists.flatMap((group) =>
				group.data.map((playlist) => ({
					...playlist,
					coverImg: playlist.coverImg.replace(/^http:/, 'https:'),
				})),
			)
			set({ playlists: combinedData })
		} catch (error) {
			console.error('Failed to set playlist:', error)
		}
	},
	// getMusicIndex: (musicItem) => {
	//   if (!musicItem) {
	//     return -1
	//   }
	//   const { playListIndexMap } = useLibraryStore.getState()
	//   return playListIndexMap[musicItem.platform]?.[musicItem.id] ?? -1
	// },
	// isInPlayList: (musicItem) => {
	//   if (!musicItem) {
	//     return false
	//   }
	//   const { playListIndexMap } = useLibraryStore.getState()
	//   return playListIndexMap[musicItem.platform]?.[musicItem.id] > -1
	// },
	// getPlayListMusicAt: (index) => {
	//   const { tracks } = useLibraryStore.getState()
	//   const len = tracks.length
	//   if (len === 0) {
	//     return null
	//   }
	//   return tracks[(index + len) % len]
	// },
	// isPlayListEmpty: () => {
	//   const { tracks } = useLibraryStore.getState()
	//   return tracks.length === 0
	// },
}))

export const useTracks = () => {
	const { tracks, fetchTracks } = useLibraryStore()
	const homeBoardSource = normalizeLeaderboardSource(
		PersistStatus.useValue('music.homeBoardSource', DEFAULT_HOME_SOURCE) ?? DEFAULT_HOME_SOURCE,
	)
	const homeBoardId = normalizeBoardId(
		PersistStatus.useValue('music.homeBoardId', DEFAULT_HOME_BOARD_ID) ?? DEFAULT_HOME_BOARD_ID,
		homeBoardSource,
	)
	const boardKey = `${homeBoardSource}:${homeBoardId}`
	const lastBoardKeyRef = useRef(boardKey)
	useEffect(() => {
		if (lastBoardKeyRef.current !== boardKey) {
			lastBoardKeyRef.current = boardKey
			fetchTracks(true, homeBoardId)
			return
		}
		fetchTracks(false, homeBoardId)
	}, [fetchTracks, boardKey, homeBoardId])
	return tracks
}
export const useAllTracks = () => {
	const allTracks = useLibraryStore((state) => state.allTracks)
	return allTracks
}
// export const useSetPlayList = () => {
//   const { tracks, setPlayList } = useLibraryStore()
//   useEffect(() => {
//      setPlayList(tracks)
//   }, [setPlayList])
//   return tracks
// }

export const useFavorites = () => {
	const favorites = useLibraryStore((state) => state.favorites)
	const toggleTrackFavorite = useLibraryStore((state) => state.toggleTrackFavorite)
	return {
		favorites,
		toggleTrackFavorite,
	}
}
export const useNowLyric = () => {
	const nowLyric = useLibraryStore((state) => state.nowLyric)
	const setNowLyric = useLibraryStore((state) => state.setNowLyric)
	return { nowLyric, setNowLyric }
}
export const useArtists = () =>
	useLibraryStore((state) => {
		return state.tracks.reduce((acc, track) => {
			const existingArtist = acc.find((artist) => artist.name === track.artist)
			if (existingArtist) {
				existingArtist.tracks.push(track)
			} else {
				acc.push({
					name: track.artist ?? 'Unknown',
					tracks: [track],
					singerImg: track.singerImg,
				})
			}
			return acc
		}, [] as Artist[])
	})

export const usePlaylists = () => {
	const playlists = useLibraryStore((state) => {
		return state.playlists
	})

	const setPlayList = useLibraryStore((state) => state.setPlayList)
	useEffect(() => {
		setPlayList()
	}, [setPlayList])
	return { playlists, setPlayList }
}
export const useTracksLoading = () => {
	return useLibraryStore((state) => state.isLoading)
}

export const useTracksRefreshing = () => useLibraryStore((state) => state.isRefreshing)

export const useTracksError = () => useLibraryStore((state) => state.error)
