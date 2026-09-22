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

export interface LxListAction {
	action: string
	data?: any
}
