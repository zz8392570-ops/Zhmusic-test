// helpers/searchAll.ts

import { searchArtist, searchMusic } from '@/helpers/userApi/xiaoqiu'
import type { Track } from '@/player/types'

const PAGE_SIZE = 20

type SearchType = 'songs' | 'artists'

const searchAll = async (
	searchText: string,
	page: number = 1,
	type: SearchType = 'songs',
): Promise<{ data: Track[]; hasMore: boolean }> => {
	let result
	if (type === 'songs') {
		result = await searchMusic(searchText, page, PAGE_SIZE)
	} else {
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
	}

	return {
		data: result.data as Track[],
		hasMore: !result.isEnd,
	}
}

export default searchAll
