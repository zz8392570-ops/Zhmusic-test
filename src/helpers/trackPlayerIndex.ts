import { sortIndexSymbol, timeStampSymbol } from '@/constants/commonConst'
import { SoundAsset } from '@/constants/constant'
import Config from '@/store/config'
import delay from '@/utils/delay'
import { isSameMediaItem, mergeProps, sortByTimestampAndIndex } from '@/utils/mediaItem'
import * as FileSystem from 'expo-file-system/legacy'
import { produce } from 'immer'
import * as Network from 'expo-network'
import shuffle from 'lodash.shuffle'
import FileSystemNative from '../../modules/cymusic-native'
import ReactNativeTrackPlayer, {
	Event,
	PlaybackState,
	type MediaItem,
	type PlaybackProgressUpdatedEvent,
	usePlaybackState,
	useProgress,
} from '@rntp/player'
import type { Track } from '@/player/types'
import { getNativeTrackIdentity, toMediaItem } from '@/player/mediaItem'

import { MusicRepeatMode } from '@/helpers/types'
import type { AudioQuality } from '@/helpers/audioQuality'
import PersistStatus from '@/store/PersistStatus'
import {
	getMusicIndex,
	getPlayList,
	getPlayListMusicAt,
	isInPlayList,
	isPlayListEmpty,
	setPlayList,
	usePlayList,
} from '@/store/playList'
import { createMediaIndexMap } from '@/utils/mediaIndexMap'
import { Alert, Image } from 'react-native'

import { myGetLyric } from '@/helpers/userApi/getMusicSource'

import { fakeAudioMp3Uri } from '@/constants/images'
import i18n, { nowLanguage } from '@/utils/i18n'
import { showToast } from '@/utils/utils'
import {
	getPlaybackSourceSwitchReason,
	showAutomaticSourceSwitchNotice,
	showSourceExhaustedNotice,
} from '@/utils/sourceSwitchNotice'
import { resolveLocalFile } from './localFile'
import {
	enqueueDownload,
	cancelCacheTask,
	resumeCacheTasks,
	restoreDownloadTasks,
	clearAutomaticDownloads,
	downloadPlaylist,
	configureDownloads,
	setCacheLimitMB,
	getProtectedDownloadPaths,
} from '@/player/DownloadManager'
import { requestAbortError } from './requestControl'
import { logError, logInfo } from './logger'
import {
	addMusicApi,
	clearFailedApis,
	deleteMusicApiById,
	ensureApiRuntime,
	getFailedApiIds,
	getPlaybackFailoverApis,
	getMusicFailureKey,
	rememberFailedApi,
	reloadMusicApi,
	runBackgroundHealthTests,
	seedBundledMusicSources,
	setMusicApiAsSelectedById,
	testAllMusicApis,
	testMusicApiById,
} from './userApi/musicApiControl'

import {
	currentMusicStore,
	playListsStore,
	repeatModeStore,
	qualityStore,
	musicApiStore,
	musicApiSelectedStore,
	nowApiState,
	musicApiTestingStore,
	autoCacheLocalStore,
	autoCacheWifiOnlyStore,
	cacheDownloadTasksStore,
	isCachedIconVisibleStore,
	songsNumsToLoadStore,
	importedLocalMusicStore,
	recentlyPlayedStore,
	nowLyricState,
	trackSkipLoadingStore,
	trackSourceLoadingStore,
	sourceLoadingProgressStore,
	sourceLoadingErrorStore,
	playbackIntentStore,
	playbackQualityStore,
	playbackCachedStore,
	cacheRevisionStore,
} from '@/player/PlayerStore'

import {
	isCached,
	migrateCacheRetention,
	clearCache as clearCacheFiles,
	getCacheFileUri,
	forgetCachedFile,
	ensureDirExists,
} from '@/player/CacheManager'

import { resolveSource, preloadSource } from '@/player/MusicSourceResolver'

const NEXT_TRACK_PRELOAD_DELAY_MS = 8000
const createTrackSourceLoadingToken = (musicItem: IMusic.IMusicItem) =>
	`track_source_${musicItem.id}_${Date.now().toString(36)}_${Math.random()
		.toString(36)
		.slice(2, 8)}`

export {
	playListsStore,
	repeatModeStore,
	qualityStore,
	musicApiStore,
	musicApiSelectedStore,
	nowApiState,
	musicApiTestingStore,
	autoCacheLocalStore,
	autoCacheWifiOnlyStore,
	cacheDownloadTasksStore,
	isCachedIconVisibleStore,
	songsNumsToLoadStore,
	importedLocalMusicStore,
	recentlyPlayedStore,
	nowLyricState,
	trackSkipLoadingStore,
	trackSourceLoadingStore,
	playbackIntentStore,
	playbackQualityStore,
	playbackCachedStore,
	cacheRevisionStore,
}

export function useCurrentQuality() {
	const currentQuality = qualityStore.useValue()
	const setCurrentQuality = (newQuality: IMusic.IQualityKey) => {
		setQuality(newQuality)
	}
	return [currentQuality, setCurrentQuality] as const
}

let currentIndex = -1

let playerSubscriptions: { remove(): void }[] = []
let controlRevision = 0
let activeTrackSkip: symbol | null = null
let activeSourceRequest: AbortController | null = null
let nativeQueue: {
	token: string
	track: Track
	startedAt: number
	handoffConsumed: boolean
} | null = null

/** Validate against the current native queue, not a queued event's index alone. */
function isCurrentNativeItem(item: MediaItem | null | undefined, placeholder = false) {
	if (!nativeQueue || !isCurrentMusic(nativeQueue.track as IMusic.IMusicItem)) return false
	const identity = getNativeTrackIdentity(item)
	const active = ReactNativeTrackPlayer.getActiveMediaItem()
	const activeIdentity = getNativeTrackIdentity(active)
	return (
		identity?.token === nativeQueue.token &&
		identity.placeholder === placeholder &&
		activeIdentity?.token === nativeQueue.token &&
		activeIdentity.placeholder === placeholder &&
		item?.mediaId === active?.mediaId &&
		ReactNativeTrackPlayer.getActiveMediaItemIndex() === (placeholder ? 1 : 0)
	)
}

function isCurrentProgressEvent(event: PlaybackProgressUpdatedEvent) {
	const active = ReactNativeTrackPlayer.getActiveMediaItem()
	return (
		isCurrentNativeItem(active) &&
		event.mediaId === active?.mediaId &&
		Number.isFinite(event.timestamp) &&
		event.timestamp >= nativeQueue.startedAt
	)
}

function setPlaybackIntent(intent: 'play' | 'pause' | 'stop') {
	controlRevision++
	playbackIntentStore.setValue(intent)
}

function retireTrackSkip() {
	activeTrackSkip = null
	trackSkipLoadingStore.setValue(null)
}

function handleNativeTransition(item: MediaItem | null | undefined, index: number | null) {
	// clear() can omit item entirely. A duplicate/stale placeholder must not advance.
	if (
		item == null ||
		index !== 1 ||
		!isCurrentNativeItem(item, true) ||
		nativeQueue.handoffConsumed ||
		trackSourceLoadingStore.getValue() !== null ||
		playbackIntentStore.getValue() !== 'play'
	)
		return
	nativeQueue.handoffConsumed = true
	logInfo('队列末尾，播放下一首')
	const advance =
		repeatModeStore.getValue() === MusicRepeatMode.SINGLE ? play(null, true) : skipToNext()
	void advance.catch((error) => logError('自动切歌失败', error))
}

function observeNativeTransport(intent: 'play' | 'pause' | 'stop') {
	// Hybrid transport already ran natively. Only reconcile pending JS work here.
	setPlaybackIntent(intent)
	if (intent === 'play') {
		// Pause can arrive before a queued placeholder transition reaches JS. A
		// later native resume must complete that deferred business-queue handoff.
		handleNativeTransition(
			ReactNativeTrackPlayer.getActiveMediaItem(),
			ReactNativeTrackPlayer.getActiveMediaItemIndex(),
		)
	}
}

function reset() {
	activeSourceRequest?.abort(requestAbortError())
	activeSourceRequest = null
	sourceLoadingProgressStore.setValue(null)
	sourceLoadingErrorStore.setValue(null)
	controlRevision++
	retireTrackSkip()
	playbackIntentStore.setValue('stop')
	trackSourceLoadingStore.setValue(null)
	playbackQualityStore.setValue(null)
	playbackCachedStore.setValue(false)
	nativeQueue = null
	ReactNativeTrackPlayer.clear()
}

const hotModule = module as typeof module & { hot?: { dispose(callback: () => void): void } }
hotModule.hot?.dispose(() => {
	reset()
	playerSubscriptions.forEach((subscription) => subscription.remove())
	playerSubscriptions = []
})

function migrate() {
	PersistStatus.set('music.rate', 1)
	PersistStatus.set('music.repeatMode', MusicRepeatMode.QUEUE)
	PersistStatus.set('music.progress', 0)
	Config.set('status.music', undefined)
}

async function setupTrackPlayer() {
	migrate()
	const rate = PersistStatus.get('music.rate')
	const musicQueue = PersistStatus.get('music.play-list')
	const legacyMusicQueue = PersistStatus.get('music.playList')
	const repeatMode = PersistStatus.get('music.repeatMode')
	const quality = PersistStatus.get('music.quality') || '128k'
	const playLists = PersistStatus.get('music.playLists')
	const musicApiLists = PersistStatus.get('music.musicApi')
	const selectedMusicApi = PersistStatus.get('music.selectedMusicApi')
	const importedLocalMusic = PersistStatus.get('music.importedLocalMusic')
	const recentlyPlayed = PersistStatus.get('music.recentlyPlayed') ?? []
	const autoCacheLocal = PersistStatus.get('music.autoCacheLocal') ?? true
	const autoCacheWifiOnly = PersistStatus.get('music.autoCacheWifiOnly') ?? true
	const language = PersistStatus.get('app.language') ?? 'zh'
	const isCachedIconVisible = PersistStatus.get('music.isCachedIconVisible') ?? true
	const songsNumsToLoad = PersistStatus.get('music.songsNumsToLoad') ?? 100
	const restoredQueue = musicQueue ?? legacyMusicQueue

	if (!musicQueue && legacyMusicQueue) {
		PersistStatus.set('music.play-list', legacyMusicQueue)
		PersistStatus.set('music.playList', undefined)
	}
	// 状态恢复
	if (rate) {
		ReactNativeTrackPlayer.setPlaybackSpeed(+rate)
	}
	if (repeatMode) {
		repeatModeStore.setValue(repeatMode as MusicRepeatMode)
	}

	if (quality) {
		setQuality(quality as IMusic.IQualityKey)
	}
	if (playLists) {
		const resolvedPlayLists = await Promise.all(
			playLists.map(async (playList) => {
				const [artwork, coverImg] = await Promise.all([
					resolveLocalFile(playList.artwork),
					resolveLocalFile(playList.coverImg),
				])
				return {
					...playList,
					...(artwork.status === 'resolved' ? { artwork: artwork.fileUri } : {}),
					...(coverImg.status === 'resolved' ? { coverImg: coverImg.fileUri } : {}),
				}
			}),
		)
		// Project cover addresses for display only; preserve stored IDs, songs and URLs.
		playListsStore.setValue(resolvedPlayLists)
	}
	if (musicApiLists) {
		musicApiStore.setValue(musicApiLists)
	}
	try {
		await seedBundledMusicSources()
	} catch (error) {
		logError('注入内嵌音源失败:', error)
	}
	const seededApis = musicApiStore.getValue() || []
	if (selectedMusicApi) {
		musicApiSelectedStore.setValue(selectedMusicApi)
		await reloadNowSelectedMusicApi()
	} else if (seededApis.length) {
		await setMusicApiAsSelectedById(seededApis[0].id, { silent: true, notify: false })
	}
	void runBackgroundHealthTests()
	if (importedLocalMusic) {
		importedLocalMusicStore.setValue(importedLocalMusic)
	}
	await migrateCacheRetention()
	restoreDownloadTasks()
	recentlyPlayedStore.setValue(recentlyPlayed)
	if (restoredQueue && Array.isArray(restoredQueue)) {
		addAll(restoredQueue, undefined, repeatMode === MusicRepeatMode.SHUFFLE)
	}
	if (autoCacheLocal == true || autoCacheLocal == false) {
		autoCacheLocalStore.setValue(autoCacheLocal)
	}
	autoCacheWifiOnlyStore.setValue(autoCacheWifiOnly)
	if (isCachedIconVisible == true || isCachedIconVisible == false) {
		isCachedIconVisibleStore.setValue(isCachedIconVisible)
	}
	if (language) {
		nowLanguage.setValue(language)
	}
	if (songsNumsToLoad) {
		songsNumsToLoadStore.setValue(songsNumsToLoad)
	}
	if (playerSubscriptions.length === 0) {
		playerSubscriptions.push(
			ReactNativeTrackPlayer.addEventListener(Event.MediaItemTransition, (event) => {
				handleNativeTransition(event.item, event.index)
			}),
			ReactNativeTrackPlayer.addEventListener(Event.PlaybackError, (error) => {
				if (
					!error.message ||
					trackSourceLoadingStore.getValue() !== null ||
					ReactNativeTrackPlayer.getPlaybackState() !== PlaybackState.Error ||
					!isCurrentNativeItem(ReactNativeTrackPlayer.getActiveMediaItem())
				)
					return
				logInfo('播放出错', { message: error.message, code: error.code })
				void failToPlay(error).catch((failure) => logError('播放错误恢复失败', failure))
			}),
		)
		logInfo('播放器初始化完成')
	}
}

/**
 * 获取自动播放的下一个track，保持nextTrack 不变,生成nextTrack的with fake url 形式  假音频
 * 获取下一个 track 并设置其属性为假音频。这在测试或处理特殊情况时非常有用
 */
const getFakeNextTrack = (): Track => {
	const repeatMode = repeatModeStore.getValue()
	const track = getPlayListMusicAt(currentIndex + (repeatMode === MusicRepeatMode.SINGLE ? 0 : 1))
	return {
		id: track?.id ?? 'empty',
		platform: track?.platform,
		title: track?.title,
		artist: track?.artist,
		album: track?.album,
		artwork: track?.artwork,
		url: Image.resolveAssetSource(SoundAsset.fakeAudio).uri,
	}
}

let failoverInProgress = false

/** 播放失败时的情况 */
async function failToPlay(failure?: { code?: string; message?: string }) {
	if (failoverInProgress) return
	failoverInProgress = true
	try {
		const revision = controlRevision
		const failedMusic = currentMusicStore.getValue()
		const sourceToken = trackSourceLoadingStore.getValue()
		retireTrackSkip()
		if (isCurrentNativeItem(ReactNativeTrackPlayer.getActiveMediaItem())) {
			// Keep the failed item/headers so a native Play during the delay can reload
			// it immediately. That explicit intent also invalidates the delayed Next.
			ReactNativeTrackPlayer.stop()
		} else {
			nativeQueue = null
			ReactNativeTrackPlayer.clear()
		}
		await delay(500)
		if (
			revision !== controlRevision ||
			!isCurrentMusic(failedMusic) ||
			sourceToken !== trackSourceLoadingStore.getValue() ||
			playbackIntentStore.getValue() !== 'play'
		)
			return
		const selected = musicApiSelectedStore.getValue()
		if (failedMusic && selected?.id) {
			const failureKey = getMusicFailureKey(failedMusic)
			rememberFailedApi(failureKey, selected.id)
			const backup = getPlaybackFailoverApis(failedMusic).find((api) => api.id !== selected.id)
			if (backup) {
				logInfo(`播放失败，切换备用音源: ${backup.name}`)
				nativeQueue = null
				const switchedSource = await setMusicApiAsSelectedById(backup.id, {
					silent: true,
					notify: false,
				})
				if (switchedSource) {
					showAutomaticSourceSwitchNotice({
						fromSource: selected.name,
						toSource: backup.name,
						reason: getPlaybackSourceSwitchReason(failure?.code, failure?.message),
						songTitle: failedMusic.title,
					})
				}
				await play(failedMusic, true, undefined, true)
				return
			}

			const nextMusic = getPlayList()
				.map((_, offset) => getPlayListMusicAt(currentIndex + offset + 1))
				.find((item) => item && !isSameMediaItem(item, failedMusic))
			const willSkip = nextMusic != null
			const recoveryAction = await showSourceExhaustedNotice({
				songTitle: failedMusic.title,
				triedCount: getFailedApiIds(failureKey).size,
				willSkip,
			})
			clearFailedApis(failureKey)
			if (recoveryAction === 'retry') {
				await play(failedMusic, true)
				return
			}
			if (recoveryAction === 'next' && nextMusic) {
				await play(nextMusic, true)
				return
			}
			setPlaybackIntent('stop')
			return
		}
		await skipToNext()
	} finally {
		failoverInProgress = false
	}
}

// 播放模式相关
const _toggleRepeatMapping = {
	[MusicRepeatMode.SHUFFLE]: MusicRepeatMode.SINGLE,
	[MusicRepeatMode.SINGLE]: MusicRepeatMode.QUEUE,
	[MusicRepeatMode.QUEUE]: MusicRepeatMode.SHUFFLE,
}
/** 切换下一个模式 */
const toggleRepeatMode = () => {
	setRepeatMode(_toggleRepeatMapping[repeatModeStore.getValue()])
}

/**
 * 添加到播放列表
 * @param musicItems 目标歌曲
 * @param beforeIndex 在第x首歌曲前添加
 * @param shouldShuffle 随机排序
 */
const addAll = (
	musicItems: Array<IMusic.IMusicItem> = [],
	beforeIndex?: number,
	shouldShuffle?: boolean,
) => {
	const now = Date.now()
	let newPlayList: IMusic.IMusicItem[] = []
	const currentPlayList = getPlayList()
	const _musicItems = musicItems.map((item, index) => ({
		...item,
		[timeStampSymbol]: now,
		[sortIndexSymbol]: index,
	}))
	if (beforeIndex === undefined || beforeIndex < 0) {
		newPlayList = currentPlayList.concat(_musicItems.filter((item) => !isInPlayList(item)))
	} else {
		const indexMap = createMediaIndexMap(_musicItems)
		const beforeDraft = currentPlayList.slice(0, beforeIndex).filter((item) => !indexMap.has(item))
		const afterDraft = currentPlayList.slice(beforeIndex).filter((item) => !indexMap.has(item))

		newPlayList = [...beforeDraft, ..._musicItems, ...afterDraft]
	}

	if (shouldShuffle) {
		newPlayList = shuffle(newPlayList)
	}
	setPlayList(newPlayList)
	const currentMusicItem = currentMusicStore.getValue()

	if (currentMusicItem) {
		currentIndex = getMusicIndex(currentMusicItem)
	}
	updateNextMetadata()
}

/** 追加到队尾 */
const add = (musicItem: IMusic.IMusicItem | IMusic.IMusicItem[], beforeIndex?: number) => {
	addAll(Array.isArray(musicItem) ? musicItem : [musicItem], beforeIndex)
}

/**
 * 下一首播放
 * @param musicItem
 */
const addAsNextTrack = (musicItem: IMusic.IMusicItem | IMusic.IMusicItem[]) => {
	const shouldPlay = isPlayListEmpty()
	add(musicItem, currentIndex + 1)
	if (shouldPlay) {
		play(Array.isArray(musicItem) ? musicItem[0] : musicItem)
	}
}
/**
 * 是当前正在播放的音频
 *
 */
const isCurrentMusic = (musicItem: IMusic.IMusicItem | null | undefined) => {
	return isSameMediaItem(musicItem, currentMusicStore.getValue()) ?? false
}
/**
 * 从播放列表移除IMusicItem
 *
 */
const remove = async (musicItem: IMusic.IMusicItem) => {
	const playList = getPlayList()
	let newPlayList: IMusic.IMusicItem[] = []
	let currentMusic: IMusic.IMusicItem | null = currentMusicStore.getValue()
	const targetIndex = getMusicIndex(musicItem)
	let shouldPlayCurrent: boolean | null = null
	if (targetIndex === -1) {
		// 1. 这种情况应该是出错了
		return
	}
	// 2. 移除的是当前项
	if (currentIndex === targetIndex) {
		// 2.1 停止播放，移除当前项
		newPlayList = produce(playList, (draft) => {
			draft.splice(targetIndex, 1)
		})
		// 2.2 设置新的播放列表，并更新当前音乐
		if (newPlayList.length === 0) {
			currentMusic = null
			shouldPlayCurrent = false
		} else {
			currentMusic = newPlayList[currentIndex % newPlayList.length]
			// Native route loss/interruption can pause output without a remote event.
			// Intent only stands in for output while the requested source is pending.
			shouldPlayCurrent =
				ReactNativeTrackPlayer.isPlaying() ||
				(playbackIntentStore.getValue() === 'play' &&
					(trackSourceLoadingStore.getValue() !== null ||
						ReactNativeTrackPlayer.getPlaybackState() === PlaybackState.Buffering))
		}
	} else {
		// 3. 删除
		newPlayList = produce(playList, (draft) => {
			draft.splice(targetIndex, 1)
		})
	}

	setPlayList(newPlayList)
	setCurrentMusic(currentMusic)
	if (shouldPlayCurrent === true) {
		await play(currentMusic, true)
	} else if (shouldPlayCurrent === false) {
		reset()
	} else {
		updateNextMetadata()
	}
}

const moveQueueTrack = (fromIndex: number, toIndex: number) => {
	const playList = getPlayList()
	if (
		fromIndex === toIndex ||
		fromIndex < 0 ||
		toIndex < 0 ||
		fromIndex >= playList.length ||
		toIndex >= playList.length
	)
		return false
	const next = [...playList]
	const [item] = next.splice(fromIndex, 1)
	next.splice(toIndex, 0, item)
	setPlayList(next)
	currentIndex = getMusicIndex(currentMusicStore.getValue())
	updateNextMetadata()
	return true
}

function updateNextMetadata() {
	if (!nativeQueue || ReactNativeTrackPlayer.getQueue().length < 2) return
	const next = getFakeNextTrack()
	ReactNativeTrackPlayer.updateMetadata(1, {
		title: next.title ?? '',
		artist: next.artist ?? '',
		albumTitle: next.album ?? '',
		artworkUrl: next.artwork?.trim() || '',
	})
}

/**
 * 设置播放模式
 * @param mode 播放模式
 */
const setRepeatMode = (mode: MusicRepeatMode) => {
	const playList = getPlayList()
	let newPlayList
	const prevMode = repeatModeStore.getValue()

	if (
		(prevMode === MusicRepeatMode.SHUFFLE && mode !== MusicRepeatMode.SHUFFLE) ||
		(mode === MusicRepeatMode.SHUFFLE && prevMode !== MusicRepeatMode.SHUFFLE)
	) {
		if (mode === MusicRepeatMode.SHUFFLE) {
			newPlayList = shuffle(playList)
		} else {
			newPlayList = sortByTimestampAndIndex(playList, true)
		}
		setPlayList(newPlayList)
	}

	const currentMusicItem = currentMusicStore.getValue()
	currentIndex = getMusicIndex(currentMusicItem)
	repeatModeStore.setValue(mode)
	// 更新下一首歌的信息
	updateNextMetadata()
	// 记录
	PersistStatus.set('music.repeatMode', mode)
}

/** 清空播放列表 */
const clear = async () => {
	setPlayList([])
	setCurrentMusic(null)

	reset()
	PersistStatus.set('music.musicItem', undefined)
	PersistStatus.set('music.progress', 0)
}
/** 清空待播列表 */
const clearToBePlayed = async () => {
	// 获取当前正在播放的音乐
	const currentMusic = currentMusicStore.getValue()

	if (currentMusic) {
		// 设置播放列表仅包含当前正在播放的音乐
		setPlayList([currentMusic])
		setCurrentMusic(currentMusic)

		updateNextMetadata()
	} else {
		// 如果没有当前播放的音乐，清空播放列表
		setPlayList([])
		setCurrentMusic(null)
		reset()
	}
}

/** 暂停 */
const pause = () => {
	setPlaybackIntent('pause')
	ReactNativeTrackPlayer.pause()
}

const stop = () => {
	setPlaybackIntent('stop')
	ReactNativeTrackPlayer.stop()
}

/** 设置音源 */
const setTrackSource = (track: Track) => {
	const requestedTrack = currentMusicStore.getValue()
	currentIndex = getMusicIndex(track as IMusic.IMusicItem)
	const token = createTrackSourceLoadingToken(track as IMusic.IMusicItem)
	// Snapshot after source resolution. A preference change never reloads the active item.
	const playbackOptions = { preciseSeeking: PersistStatus.get('music.preciseSeeking') === true }
	const items = [
		toMediaItem(track, token, false, playbackOptions),
		toMediaItem(getFakeNextTrack(), token, true),
	]
	// Keep the complete resolved source in JS. v5 getter projections lose headers.
	nativeQueue = { token, track, startedAt: Date.now(), handoffConsumed: false }
	ReactNativeTrackPlayer.setMediaItems(items)
	const recentTrack =
		requestedTrack && isSameMediaItem(requestedTrack, track as IMusic.IMusicItem)
			? requestedTrack
			: (track as IMusic.IMusicItem)
	const recent = recentlyPlayedStore
		.getValue()
		.filter((item) => !isSameMediaItem(item, recentTrack))
	const nextRecent = [{ ...recentTrack, lastPlayedAt: Date.now() }, ...recent].slice(0, 100)
	recentlyPlayedStore.setValue(nextRecent)
	PersistStatus.set('music.recentlyPlayed', nextRecent)
	setCurrentMusic(track as IMusic.IMusicItem)
	PersistStatus.set('music.musicItem', track as IMusic.IMusicItem)
	PersistStatus.set('music.progress', 0)

	const intent = playbackIntentStore.getValue()
	if (intent === 'play') {
		ReactNativeTrackPlayer.play()
	} else if (intent === 'stop') {
		// A source may finish resolving after Stop. Retain it for a later Play,
		// without letting setMediaItems change the requested stopped state.
		ReactNativeTrackPlayer.stop()
	}
}
/**
 * 设置currentMusicStore，更新currentIndex
 *
 */
const setCurrentMusic = (musicItem?: IMusic.IMusicItem | null) => {
	if (!musicItem) {
		currentIndex = -1
		currentMusicStore.setValue(null)
		trackSourceLoadingStore.setValue(null)
		PersistStatus.set('music.musicItem', undefined)
		PersistStatus.set('music.progress', 0)
		return
	}
	currentIndex = getMusicIndex(musicItem)
	currentMusicStore.setValue(musicItem)
}

const setQuality = (quality: IMusic.IQualityKey) => {
	qualityStore.setValue(quality)
	PersistStatus.set('music.quality', quality)
}
//添加歌曲到指定歌单
const addSongToStoredPlayList = (playlist: IMusic.PlayList, track: IMusic.IMusicItem) => {
	try {
		const nowPlayLists = playListsStore.getValue() || []
		const target = nowPlayLists.find((item) => item.id === playlist.id)
		if (!target) return 'not-found' as const
		if (target.songs.some((song) => isSameMediaItem(song, track))) {
			logInfo('歌曲已存在')
			return 'duplicate' as const
		}
		const updatedPlayLists = nowPlayLists.map((existingPlaylist) => {
			if (existingPlaylist.id === playlist.id) {
				return {
					...existingPlaylist,
					songs: [...existingPlaylist.songs, track],
				}
			}
			return existingPlaylist
		})

		playListsStore.setValue(updatedPlayLists)
		PersistStatus.set('music.playLists', updatedPlayLists)
		logInfo('歌曲成功添加到歌单')
		return 'success' as const
	} catch (error) {
		logError('添加歌曲到歌单时出错:', error)
		return 'error' as const
	}
}
//从歌单删除指定歌曲
//添加歌曲到指定歌单
const deleteSongFromStoredPlayList = (playlist: IMusic.PlayList, trackId: string) => {
	try {
		const nowPlayLists = playListsStore.getValue() || []
		const updatedPlayLists = nowPlayLists.map((existingPlaylist) => {
			if (existingPlaylist.id === playlist.id) {
				// 检查歌曲是否已经存在于播放列表中
				const songExists = existingPlaylist.songs.some((song) => song.id == trackId)

				if (songExists) {
					// 只有当歌曲存在时才删除
					return {
						...existingPlaylist,
						songs: existingPlaylist.songs.filter((song) => song.id !== trackId),
					}
				} else {
					logInfo('歌曲不存在')
				}
			}
			return existingPlaylist
		})

		playListsStore.setValue(updatedPlayLists)
		PersistStatus.set('music.playLists', updatedPlayLists)
		logInfo('歌曲成功删除')
	} catch (error) {
		logError('删除歌曲到歌单时出错:', error)
		// 可以在这里添加一些错误处理逻辑，比如显示一个错误提示给用户
	}
}
const replaceStoredPlaylistSongs = (playlistId: string, songs: IMusic.IMusicItem[]) => {
	try {
		const nowPlayLists = playListsStore.getValue() || []
		if (!nowPlayLists.some((playlist) => playlist.id === playlistId)) return 'not-found' as const
		const updated = nowPlayLists.map((playlist) =>
			playlist.id === playlistId ? { ...playlist, songs: [...songs] } : playlist,
		)
		playListsStore.setValue(updated)
		PersistStatus.set('music.playLists', updated)
		return 'success' as const
	} catch (error) {
		logError('Error replacing playlist songs:', error)
		return 'error' as const
	}
}
const replaceSongInStoredPlayList = (
	playlistId: string,
	original: IMusic.IMusicItem,
	replacement: IMusic.IMusicItem,
) => {
	const playlists = playListsStore.getValue() || []
	const playlist = playlists.find((item) => item.id === playlistId)
	if (!playlist) return 'not-found' as const
	const index = playlist.songs.findIndex((song) => isSameMediaItem(song, original))
	if (index < 0) return 'not-found' as const
	if (
		playlist.songs.some(
			(song, songIndex) => songIndex !== index && isSameMediaItem(song, replacement),
		)
	) {
		return 'duplicate' as const
	}
	const songs = [...playlist.songs]
	songs[index] = replacement
	const originalKey = `${original.platform}@${original.id}`
	const replacementKey = `${replacement.platform}@${replacement.id}`
	const snapshotKeys = Array.isArray(playlist.sourceSnapshotKeys)
		? playlist.sourceSnapshotKeys.filter((key): key is string => typeof key === 'string')
		: []
	const existingOverrides =
		playlist.sourceOverrides && typeof playlist.sourceOverrides === 'object'
			? (playlist.sourceOverrides as Record<string, string>)
			: {}
	const overrides = { ...existingOverrides }
	const overriddenSourceKey = snapshotKeys.includes(originalKey)
		? originalKey
		: Object.entries(overrides).find(([, value]) => value === originalKey)?.[0]
	if (overriddenSourceKey) overrides[overriddenSourceKey] = replacementKey
	const updated = playlists.map((item) =>
		item.id === playlistId ? { ...item, songs, sourceOverrides: overrides } : item,
	)
	playListsStore.setValue(updated)
	PersistStatus.set('music.playLists', updated)
	return 'success' as const
}
const addPlayLists = (playlist: IMusic.PlayList) => {
	try {
		const nowPlayLists = playListsStore.getValue() || []

		// 检查播放列表是否已存在
		const playlistExists = nowPlayLists.some(
			(existingPlaylist) => existingPlaylist.id == playlist.id,
		)

		if (playlistExists) {
			// logInfo(`Playlist already exists, not adding duplicate. Current playlists: ${JSON.stringify(nowPlayLists, null, 2)}`);
			return 'duplicate' as const
		}

		// 如果播放列表不存在，则添加它
		const updatedPlayLists = [...nowPlayLists, playlist]
		playListsStore.setValue(updatedPlayLists)
		PersistStatus.set('music.playLists', updatedPlayLists)
		logInfo('Playlist added successfully')
		return 'success' as const
	} catch (error) {
		logError('Error adding playlist:', error)
		return 'error' as const
	}
}
const updateStoredPlaylist = (playlistId: string, patch: Partial<Omit<IMusic.PlayList, 'id'>>) => {
	try {
		if (playlistId === 'favorites' || playlistId === 'local' || playlistId === 'recent') {
			return 'protected' as const
		}
		const nowPlayLists = playListsStore.getValue() || []
		if (!nowPlayLists.some((playlist) => playlist.id === playlistId)) return 'not-found' as const
		const updated = nowPlayLists.map((playlist) =>
			playlist.id === playlistId ? { ...playlist, ...patch } : playlist,
		)
		playListsStore.setValue(updated)
		PersistStatus.set('music.playLists', updated)
		return 'success' as const
	} catch (error) {
		logError('Error updating playlist:', error)
		return 'error' as const
	}
}
const deletePlayLists = (playlistId: string) => {
	try {
		if (playlistId === 'favorites' || playlistId === 'local' || playlistId === 'recent') {
			return 'protected'
		}
		const nowPlayLists = playListsStore.getValue() || []
		if (!nowPlayLists.some((playlist) => playlist.id === playlistId)) return 'not-found' as const

		// 检查播放列表是否已存在
		const playlistFiltered = nowPlayLists.filter(
			(existingPlaylist) => existingPlaylist.id !== playlistId,
		)

		// 如果播放列表不存在，则添加它
		const updatedPlayLists = [...playlistFiltered]
		playListsStore.setValue(updatedPlayLists)
		PersistStatus.set('music.playLists', updatedPlayLists)
		logInfo('Playlist deleted successfully')
		return 'success'
	} catch (error) {
		logError('Error deleted playlist:', error)
	}
}
const getPlayListById = (playlistId: string) => {
	try {
		// logInfo(playlistId + 'playlistId')
		const nowPlayLists = playListsStore.getValue() || []
		const playlistFiltered = nowPlayLists.filter(
			(existingPlaylist) => existingPlaylist.id === playlistId,
		)
		return playlistFiltered
	} catch (error) {
		logError('Error find playlist:', error)
	}
}
const reloadNowSelectedMusicApi = async () => {
	try {
		const selectedApi = musicApiSelectedStore.getValue()

		if (selectedApi === null) {
			logInfo('No music API is currently selected.')
			return null
		}
		const reloadedApi = await ensureApiRuntime({ ...selectedApi, isSelected: true })
		musicApiSelectedStore.setValue(reloadedApi)
		PersistStatus.set('music.selectedMusicApi', reloadedApi)
		logInfo(`Selected music API "${reloadedApi.name}" reloaded successfully`)
		return reloadedApi
	} catch (error) {
		logError('Error reloading selected music API:', error)
		throw error
	}
}
const play = async (
	musicItem?: IMusic.IMusicItem | null,
	forcePlay?: boolean,
	skipOperation?: symbol,
	isAutomaticRecovery = false,
) => {
	let trackSourceLoadingToken: string | null = null
	let sourceRequest: AbortController | null = null
	try {
		// A direct selection supersedes an older Next/Previous request. Its late
		// finally must not clear a newer navigation operation with the same direction.
		if (skipOperation !== activeTrackSkip) retireTrackSkip()
		if (!musicItem) {
			musicItem = currentMusicStore.getValue()
		}
		if (!musicItem) {
			throw new Error(PlayFailReason.PLAY_LIST_IS_EMPTY)
		}
		// Automatic recovery must retain failed sources or A → B will retry A forever.
		if (!isAutomaticRecovery && (!isCurrentMusic(musicItem) || forcePlay)) {
			clearFailedApis(getMusicFailureKey(musicItem))
		}
		setPlaybackIntent('play')

		// 1. If already playing this track
		if (isCurrentMusic(musicItem)) {
			// Resume an outstanding request without starting another one. Its result
			// reads the latest intent; explicit replacement still gets a new token.
			if (trackSourceLoadingStore.getValue() !== null && !forcePlay) return
			const firstItem = ReactNativeTrackPlayer.getQueue()[0]
			if (
				nativeQueue &&
				getNativeTrackIdentity(firstItem)?.token === nativeQueue.token &&
				isSameMediaItem(musicItem, nativeQueue.track as IMusic.IMusicItem)
			) {
				trackSourceLoadingStore.setValue(null)
				if (
					forcePlay ||
					ReactNativeTrackPlayer.getActiveMediaItemIndex() !== 0 ||
					ReactNativeTrackPlayer.getPlaybackState() === PlaybackState.Error
				) {
					// A fresh transport token also retires already-queued placeholder events.
					setTrackSource(nativeQueue.track)
				} else {
					// In v5, Play reloads a stopped retained item from zero, including headers.
					ReactNativeTrackPlayer.play()
				}
				return
			}
		}

		// 2. Add to playlist if not present
		if (!isInPlayList(musicItem)) {
			add(musicItem)
		}

		trackSourceLoadingToken = createTrackSourceLoadingToken(musicItem)
		activeSourceRequest?.abort(requestAbortError())
		sourceRequest = new AbortController()
		activeSourceRequest = sourceRequest
		sourceLoadingProgressStore.setValue({ stage: 'resolving' })
		sourceLoadingErrorStore.setValue(null)
		trackSourceLoadingStore.setValue(trackSourceLoadingToken)
		playbackQualityStore.setValue(null)
		playbackCachedStore.setValue(false)

		// 3. Update current music state immediately (UI updates instantly)
		setCurrentMusic(musicItem)
		nowLyricState.setValue(null)

		// 4. Resolve source (cache check + network if needed)
		const {
			url: sourceUrl,
			wasCached,
			quality: playbackQuality,
		} = await resolveSource(musicItem, {
			requestType: 'current',
			signal: sourceRequest.signal,
			onProgress: (progress) => {
				if (trackSourceLoadingStore.getValue() === trackSourceLoadingToken)
					sourceLoadingProgressStore.setValue(progress)
			},
		})

		// 5. Race condition guard
		if (
			!isCurrentMusic(musicItem) ||
			trackSourceLoadingStore.getValue() !== trackSourceLoadingToken
		) {
			return
		}

		// 6. Build track and set source
		playbackQualityStore.setValue(playbackQuality)
		playbackCachedStore.setValue(wasCached)
		const track = mergeProps(musicItem, {
			url: wasCached ? getCacheFileUri(sourceUrl) : sourceUrl,
			playbackQuality,
			...(wasCached && playbackQuality ? { cachedQuality: playbackQuality } : {}),
		}) as IMusic.IMusicItem
		logInfo('获取音源成功：', track)
		setTrackSource(track)
		const appliedToken = nativeQueue.token

		// 7. Fetch lyrics in background (non-blocking)
		myGetLyric(musicItem)
			.then((lyricSource) => {
				if (isCurrentMusic(musicItem) && nativeQueue?.token === appliedToken) {
					nowLyricState.setValue(lyricSource)
				}
			})
			.catch((err) => logError('获取歌词失败:', err))

		// 8. Auto-cache in background
		if (
			sourceUrl !== fakeAudioMp3Uri &&
			!sourceUrl.includes('fake') &&
			!wasCached &&
			autoCacheLocalStore.getValue() &&
			!sourceUrl.startsWith('file://')
		) {
			setTimeout(async () => {
				if (autoCacheWifiOnlyStore.getValue()) {
					try {
						const state = await Network.getNetworkStateAsync()
						if (state.type !== Network.NetworkStateType.WIFI) return
					} catch (error) {
						logError('检查自动缓存网络状态失败:', error)
						return
					}
				}
				void cacheAndImportMusic(track, {
					quality: playbackQuality ?? qualityStore.getValue(),
					silent: true,
					kind: 'automatic',
				})
			}, 5000)
		}

		// 9. 仅在当前曲目为远端音源时才预加载下一首，避免播放本地/缓存歌曲时继续发起音源请求
		const shouldPreloadNextTrack =
			sourceUrl !== fakeAudioMp3Uri &&
			!sourceUrl.includes('fake') &&
			!sourceUrl.startsWith('file://')
		const nextTrack = getPlayListMusicAt(currentIndex + 1)
		if (shouldPreloadNextTrack && nextTrack && !isSameMediaItem(nextTrack, musicItem)) {
			setTimeout(() => {
				preloadSource(nextTrack).catch(() => {})
			}, NEXT_TRACK_PRELOAD_DELAY_MS)
		}
	} catch (e: any) {
		if (sourceRequest?.signal.aborted || e?.name === 'AbortError') return
		if (trackSourceLoadingToken && trackSourceLoadingStore.getValue() !== trackSourceLoadingToken)
			return
		const message = e?.message
		if (message === PlayFailReason.FORBID_CELLUAR_NETWORK_PLAY) {
			logInfo('移动网络')
		} else if (message === PlayFailReason.INVALID_SOURCE) {
			logError('音源为空，播放失败')
			await failToPlay({ code: 'source', message })
		} else if (message === PlayFailReason.PLAY_LIST_IS_EMPTY) {
			// empty queue
		} else {
			logError('播放失败', e)
			stop()
			nativeQueue = null
			ReactNativeTrackPlayer.clear()
			sourceLoadingErrorStore.setValue(
				e?.name === 'TimeoutError'
					? i18n.t('player.sourceLoading.timeout')
					: i18n.t('player.sourceLoading.failed'),
			)
		}
	} finally {
		if (trackSourceLoadingToken && trackSourceLoadingStore.getValue() === trackSourceLoadingToken) {
			trackSourceLoadingStore.setValue(null)
			sourceLoadingProgressStore.setValue(null)
		}
		if (activeSourceRequest === sourceRequest) activeSourceRequest = null
	}
}

const cancelSourceLoading = () => {
	activeSourceRequest?.abort(requestAbortError())
	activeSourceRequest = null
	trackSourceLoadingStore.setValue(null)
	sourceLoadingProgressStore.setValue(null)
	sourceLoadingErrorStore.setValue(null)
	retireTrackSkip()
	stop()
}

const retryWithNextSource = async () => {
	const track = currentMusicStore.getValue()
	if (!track) return
	const selected = musicApiSelectedStore.getValue()
	const alternative = getPlaybackFailoverApis(track).find((api) => api.id !== selected?.id)
	if (!alternative) {
		showToast(i18n.t('player.sourceLoading.noAlternative'), '', 'info')
		return
	}
	cancelSourceLoading()
	const revision = controlRevision
	nativeQueue = null
	ReactNativeTrackPlayer.clear()
	await setMusicApiAsSelectedById(alternative.id, {
		silent: true,
		notify: false,
		isCurrent: () => revision === controlRevision && isCurrentMusic(track),
	})
	if (revision !== controlRevision || !isCurrentMusic(track)) return
	await play(track, true)
}
const cacheAndImportMusic = async (
	track: IMusic.IMusicItem,
	options: { quality?: AudioQuality; silent?: boolean; kind?: 'saved' | 'automatic' } = {},
) => {
	await enqueueDownload(track, {
		...options,
		quality:
			options.quality ??
			(isCurrentMusic(track) ? playbackQualityStore.getValue() : null) ??
			qualityStore.getValue(),
	})
}

const cancelCacheDownload = cancelCacheTask

const clearCache = async () => {
	await clearAutomaticDownloads(() =>
		clearCacheFiles(() => [
			...(nativeQueue ? [nativeQueue.track.url] : []),
			...getProtectedDownloadPaths(),
		]),
	)
}

/**
 * 播放音乐，同时替换播放队列
 * @param musicItem 音乐
 * @param newPlayList 替代列表
 */
const playWithReplacePlayList = async (
	musicItem: IMusic.IMusicItem,
	newPlayList: IMusic.IMusicItem[],
) => {
	if (newPlayList.length !== 0) {
		const now = Date.now()
		const playListItems = newPlayList.map((item, index) => ({
			...item,
			[timeStampSymbol]: now,
			[sortIndexSymbol]: index,
		}))
		setPlayList(
			repeatModeStore.getValue() === MusicRepeatMode.SHUFFLE
				? shuffle(playListItems)
				: playListItems,
			true,
			true, // lazy index build - defer to first query
		)
		await play(musicItem, true)
	}
}

const runWithTrackSkipLoading = async (
	direction: 'next' | 'previous',
	action: (operation: symbol) => Promise<void>,
) => {
	if (activeTrackSkip) {
		return
	}

	const operation = Symbol(direction)
	activeTrackSkip = operation
	trackSkipLoadingStore.setValue(direction)
	try {
		await action(operation)
	} finally {
		if (activeTrackSkip === operation) {
			retireTrackSkip()
		}
	}
}

const skipToNext = async () => {
	await runWithTrackSkipLoading('next', async (operation) => {
		if (isPlayListEmpty()) {
			setCurrentMusic(null)
			reset()
			return
		}
		await play(getPlayListMusicAt(currentIndex + 1), true, operation)
	})
}

const skipToPrevious = async () => {
	await runWithTrackSkipLoading('previous', async (operation) => {
		if (isPlayListEmpty()) {
			setCurrentMusic(null)
			reset()
			return
		}

		await play(getPlayListMusicAt(currentIndex === -1 ? 0 : currentIndex - 1), true, operation)
	})
}

/** 修改当前播放的音质 */
const changeQuality = async (newQuality: IMusic.IQualityKey) => {
	// 获取当前的音乐和进度
	if (newQuality === qualityStore.getValue()) {
		return true
	}

	// 获取当前歌曲
	const musicItem = currentMusicStore.getValue()
	if (!musicItem) {
		return false
	}
	try {
		setQuality(newQuality)
		return true
	} catch {
		// 修改失败
		return false
	}
}

enum PlayFailReason {
	/** 禁止移动网络播放 */
	FORBID_CELLUAR_NETWORK_PLAY = 'FORBID_CELLUAR_NETWORK_PLAY',
	/** 播放列表为空 */
	PLAY_LIST_IS_EMPTY = 'PLAY_LIST_IS_EMPTY',
	/** 无效源 */
	INVALID_SOURCE = 'INVALID_SOURCE',
	/** 非当前音乐 */
}

function useMusicState() {
	return usePlaybackState()
}

const emptyProgress = { position: 0, duration: 0, buffered: 0, cached: 0 }

function getProgress() {
	return isCurrentNativeItem(ReactNativeTrackPlayer.getActiveMediaItem())
		? ReactNativeTrackPlayer.getProgress()
		: emptyProgress
}

function useMusicProgress(intervalSeconds = 1) {
	// v5 polls drive renders but retain the previous track's sample between ticks.
	// Read the current native snapshot so a new selection cannot borrow its duration.
	useProgress(intervalSeconds)
	currentMusicStore.useValue()
	return getProgress()
}

function getPreviousMusic() {
	const currentMusicItem = currentMusicStore.getValue()
	if (!currentMusicItem) {
		return null
	}

	return getPlayListMusicAt(currentIndex - 1)
}

function getNextMusic() {
	const currentMusicItem = currentMusicStore.getValue()
	if (!currentMusicItem) {
		return null
	}

	return getPlayListMusicAt(currentIndex + 1)
}
const addImportedLocalMusic = async (
	musicItem: IMusic.IMusicItem[],
	shouldMoveToLibrary: boolean = true,
	showSuccessAlert: boolean = shouldMoveToLibrary,
) => {
	try {
		console.log('addImportedLocalMusic', musicItem[0])
		const importedLocalMusic = importedLocalMusicStore.getValue() || []
		const newMusicItems = musicItem.filter(
			(newItem) => !importedLocalMusic.some((existingItem) => existingItem.id == newItem.id),
		)
		if (newMusicItems.length === 0) {
			// Alert.alert('提示', '所有选择的音乐已经存在，没有新的音乐被导入。')
			return 'empty'
		}
		// 手动导入需要移动到应用文档目录；自动缓存已经位于应用目录中。
		if (shouldMoveToLibrary) {
			const targetDir = `${FileSystemNative.documentDirectoryPath}/importedLocalMusic`
			await ensureDirExists(targetDir)

			// 移动文件并更新musicItem的url
			for (const item of newMusicItems) {
				if (item.url.startsWith('file://')) {
					const originalExtension = item.url.split('.').pop() || 'mp3'

					// 创建一个安全的文件名（移除或替换不允许的字符）
					const safeTitle = item.title.replace(/[/\\?%*:|"<>]/g, '-')
					const safeArtist = item.artist.replace(/[/\\?%*:|"<>]/g, '-')
					const fileName = `${safeTitle}-${safeArtist}.${originalExtension}`
					const newPath = `${targetDir}/${fileName}`
					await FileSystem.moveAsync({
						from: item.url,
						to: newPath,
					})
					item.url = newPath
				}
			}
		}
		const updatedImportedLocalMusic = [...importedLocalMusic, ...newMusicItems]
		importedLocalMusicStore.setValue(updatedImportedLocalMusic)
		PersistStatus.set('music.importedLocalMusic', updatedImportedLocalMusic)
		if (showSuccessAlert) {
			Alert.alert('成功', '音乐导入成功,请手动选择', [
				{ text: '确定', onPress: () => logInfo('Add alert closed') },
			])
		}
		return 'success'
	} catch (error) {
		logError('本地音乐保存时出错:', error)
		return 'error'
	}
}
const deleteImportedLocalMusic = async (musicItemsIdToDelete: string) => {
	try {
		const importedLocalMusic = importedLocalMusicStore.getValue() || []
		const selectedItems = importedLocalMusic.filter((item) => item.id === musicItemsIdToDelete)
		if (selectedItems.length !== 1) return
		const selectedItem = selectedItems[0]
		const localFile = await resolveLocalFile(selectedItem.url, { requireOwnedMedia: true })
		const currentItems = importedLocalMusicStore.getValue() || []
		if (
			!currentItems.includes(selectedItem) ||
			currentItems.filter((item) => item.id === musicItemsIdToDelete).length !== 1
		) {
			return
		}
		if (localFile.status === 'resolved') {
			await FileSystem.deleteAsync(localFile.fileUri)
			forgetCachedFile(localFile.filePath)
		}
		// Explicit removal may discard a missing-file record, but never guesses a file
		// target. Read the latest list after I/O so concurrent imports/deletes survive.
		const latestItems = importedLocalMusicStore.getValue() || []
		const updatedImportedLocalMusic = latestItems.filter((item) => item !== selectedItem)
		importedLocalMusicStore.setValue(updatedImportedLocalMusic)
		PersistStatus.set('music.importedLocalMusic', updatedImportedLocalMusic)
	} catch (error) {
		logError('删除本地音乐时出错:', error)
	}
}
const isExistImportedLocalMusic = (musicItemName: string) => {
	// todo 检查文件存在？
	const importedLocalMusic = importedLocalMusicStore.getValue() || []
	return importedLocalMusic.some((item) => item.genre === musicItemName)
}
const toggleAutoCacheLocal = (bool: boolean) => {
	PersistStatus.set('music.autoCacheLocal', bool)
	autoCacheLocalStore.setValue(bool)
}
const toggleAutoCacheWifiOnly = (bool: boolean) => {
	PersistStatus.set('music.autoCacheWifiOnly', bool)
	autoCacheWifiOnlyStore.setValue(bool)
}
const toggleIsCachedIconVisible = (bool: boolean) => {
	PersistStatus.set('music.isCachedIconVisible', bool)
	isCachedIconVisibleStore.setValue(bool)
}
const myTrackPlayer = {
	setupTrackPlayer,
	usePlayList,
	getPlayList,
	addAll,
	add,
	addAsNextTrack,
	skipToNext,
	skipToPrevious,
	play,
	cancelSourceLoading,
	retryWithNextSource,
	playWithReplacePlayList,
	pause,
	stop,
	observeNativeTransport,
	remove,
	moveQueueTrack,
	clear,
	clearToBePlayed,
	useCurrentMusic: currentMusicStore.useValue,
	getCurrentMusic: currentMusicStore.getValue,
	useRepeatMode: repeatModeStore.useValue,
	getRepeatMode: repeatModeStore.getValue,
	toggleRepeatMode,
	usePlaybackState,
	setRepeatMode,
	setQuality,
	getProgress,
	useProgress: useMusicProgress,
	seekTo: ReactNativeTrackPlayer.seekTo,
	isCurrentNativeItem,
	isCurrentProgressEvent,
	changeQuality,
	addPlayLists,
	updateStoredPlaylist,
	deletePlayLists,
	getPlayListById,
	addMusicApi,
	setMusicApiAsSelectedById,
	deleteMusicApiById,
	testAllMusicApis,
	testMusicApiById,
	addSongToStoredPlayList,
	deleteSongFromStoredPlayList,
	replaceStoredPlaylistSongs,
	replaceSongInStoredPlayList,
	addImportedLocalMusic,
	deleteImportedLocalMusic,
	isExistImportedLocalMusic,
	useCurrentQuality: qualityStore.useValue,
	getCurrentQuality: qualityStore.getValue,
	getRate: ReactNativeTrackPlayer.getPlaybackSpeed,
	setRate: ReactNativeTrackPlayer.setPlaybackSpeed,
	useMusicState,
	reset,
	getPreviousMusic,
	getNextMusic,
	clearCache,
	toggleAutoCacheLocal,
	toggleAutoCacheWifiOnly,
	cacheAndImportMusic,
	cancelCacheDownload,
	resumeCacheDownloads: resumeCacheTasks,
	downloadPlaylist,
	setCacheLimitMB,
	isCached,
	toggleIsCachedIconVisible,
	reloadMusicApi,
}

configureDownloads(() => [
	...(nativeQueue ? [nativeQueue.track.url] : []),
	...getProtectedDownloadPaths(),
])

export default myTrackPlayer
export { MusicRepeatMode, PlaybackState as MusicState }
