import { MusicRepeatMode } from '@/helpers/types'
import type { AudioQuality } from '@/helpers/audioQuality'
import { GlobalState } from '@/utils/stateMapper'

/** 当前播放 */
export const currentMusicStore = new GlobalState<IMusic.IMusicItem | null>(null)
/** 歌单 */
export const playListsStore = new GlobalState<IMusic.PlayList[] | []>(null)
/** 播放模式 */
export const repeatModeStore = new GlobalState<MusicRepeatMode>(MusicRepeatMode.QUEUE)
/** 音质 */
export const qualityStore = new GlobalState<IMusic.IQualityKey>('128k')
/** 当前歌曲实际使用的音质 */
export const playbackQualityStore = new GlobalState<AudioQuality | null>(null)
/** 当前歌曲是否来自缓存 */
export const playbackCachedStore = new GlobalState<boolean>(false)
/** 缓存变化通知 */
export const cacheRevisionStore = new GlobalState<number>(0)
/** 音源 */
export const musicApiStore = new GlobalState<IMusic.MusicApi[] | []>(null)
/** 当前音源 */
export const musicApiSelectedStore = new GlobalState<IMusic.MusicApi>(null)
/** 音源状态 */
export const nowApiState = new GlobalState<string>('正常')
/** 正在批量测试音源 */
export const musicApiTestingStore = new GlobalState<boolean>(false)
/** 是否自动缓存本地 */
export const autoCacheLocalStore = new GlobalState<boolean>(true)
/** 自动缓存是否仅允许 Wi-Fi */
export const autoCacheWifiOnlyStore = new GlobalState<boolean>(true)
export type CacheDownloadTask = {
	id: string
	track: IMusic.IMusicItem
	quality: AudioQuality
	progress: number
	status: 'downloading' | 'completed' | 'failed' | 'cancelled'
	error?: string
}
/** 当前会话的缓存下载任务 */
export const cacheDownloadTasksStore = new GlobalState<CacheDownloadTask[]>([])
/** 是否显示已缓存图标 */
export const isCachedIconVisibleStore = new GlobalState<boolean>(true)
/** 首页加载歌曲数量 */
export const songsNumsToLoadStore = new GlobalState<number>(100)
/** 已导入的本地音乐 */
export const importedLocalMusicStore = new GlobalState<IMusic.IMusicItem[] | []>(null)
/** 最近成功开始播放的歌曲 */
export const recentlyPlayedStore = new GlobalState<IMusic.IMusicItem[]>([])
/** 当前歌词 */
export const nowLyricState = new GlobalState<ILyric.ILyricSource | null>(null)
/** 切歌中的按钮方向 */
export const trackSkipLoadingStore = new GlobalState<'next' | 'previous' | null>(null)
/** 当前曲目音源解析中 */
export const trackSourceLoadingStore = new GlobalState<string | null>(null)
/** User transport intent; v5 readiness/output do not expose pending play intent. */
export const playbackIntentStore = new GlobalState<'play' | 'pause' | 'stop'>('pause')
