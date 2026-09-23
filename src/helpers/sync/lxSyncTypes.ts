export type LxSyncMode =
	| 'merge_local_remote'
	| 'merge_remote_local'
	| 'overwrite_local_remote_full'
	| 'overwrite_remote_local_full'

export interface LxSyncKeyInfo {
	clientId: string
	key: string
	serverName: string
}

export interface LxMusicInfo {
	id: string
	name: string
	singer: string
	source: string
	interval: string | null
	meta: {
		songId: string | number
		albumName: string
		picUrl?: string | null
		qualitys?: Array<{ type: string; size: string | null }>
		_qualitys?: Record<string, { size: string | null; [k: string]: unknown }>
		cymusic?: IMusic.IMusicItem
		[k: string]: unknown
	}
}

export interface LxUserList {
	id: string
	name: string
	source?: string
	sourceListId?: string
	locationUpdateTime: number | null
	list: LxMusicInfo[]
	cymusic?: Omit<IMusic.PlayList, 'songs'>
}

export interface LxListData {
	defaultList: LxMusicInfo[]
	loveList: LxMusicInfo[]
	userList: LxUserList[]
}

export type LxListAction =
	| { action: 'list_data_overwrite'; data: LxListData }
	| {
			action: 'list_create'
			data: { position: number; listInfos: Array<Omit<LxUserList, 'list'>> }
	}
	| { action: 'list_remove'; data: string[] }
	| { action: 'list_update'; data: Array<Partial<LxUserList> & { id: string }> }
	| { action: 'list_update_position'; data: { position: number; ids: string[] } }
	| { action: 'list_music_add'; data: LxListMusicAdd }
	| { action: 'list_music_move'; data: LxListMusicMove }
	| { action: 'list_music_remove'; data: { listId: string; ids: string[] } }
	| { action: 'list_music_update'; data: Array<{ id: string; musicInfo: LxMusicInfo }> }
	| {
			action: 'list_music_update_position'
			data: { listId: string; position: number; ids: string[] }
	}
	| { action: 'list_music_overwrite'; data: { listId: string; musicInfos: LxMusicInfo[] } }
	| { action: 'list_music_clear'; data: string[] }

interface LxListMusicAdd {
	id: string
	musicInfos: LxMusicInfo[]
	addMusicLocationType: 'top' | 'bottom'
}

interface LxListMusicMove {
	fromId: string
	toId: string
	musicInfos: LxMusicInfo[]
	addMusicLocationType: 'top' | 'bottom'
}
