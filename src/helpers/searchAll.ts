// helpers/searchAll.ts

import { searchArtist, searchMusic, searchMusicSheet } from '@/helpers/userApi/xiaoqiu'
import type { Track } from '@/player/types'

const PAGE_SIZE = 20

export type SearchType = 'songs' | 'artists' | 'playlists'

const searchAll = async (
	searchText: string,
	page: number = 1,
	type: SearchType = 'songs',
): Promise<{ data: Track[]; hasMore: boolean }> => {
	let result
	if (type === 'songs') {
		result = await searchMusic(searchText, page, PAGE_SIZE)
	} else if (type === 'artists') {
		result = await searchArtist(searchText, page)
		result.data = result.data.map((artist) => ({
			id: artist.singerMID || artist.id,
			title: artist.name,
			artist: artist.name,
			artwork: artist.avatar,
			singerMID: artist.singerMID,
			worksNum: artist.worksNum,
			isArtist: true,
		})) as Track[]
	} else {
		result = await searchMusicSheet(searchText, page)
		result.data = result.data.map((playlist) => ({
			id: String(playlist.id),
			title: playlist.title,
			artist: playlist.artist,
			artwork: playlist.artwork,
			description: playlist.description,
			playCount: playlist.playCount,
			worksNum: playlist.worksNums,
			platform: 'tx',
			isPlaylist: true,
		})) as Track[]
	}

	return {
		data: result.data as Track[],
		hasMore: !result.isEnd,
	}
}

export default searchAll
