import { fakeAudioMp3Uri } from '@/constants/images'
import { resolveLocalFile } from '@/helpers/localFile'
import { logError, logInfo } from '@/helpers/logger'
import {
	getFailedApiIds,
	getMusicFailureKey,
	rememberFailedApi,
	requestMusicUrlFromApi,
	setMusicApiAsSelectedById,
} from '@/helpers/userApi/musicApiControl'
import {
	getFailoverCandidates,
	isValidMusicUrl,
	MAX_FAILOVER_SOURCES,
} from '@/helpers/userApi/musicSourceHealth'
import PersistStatus from '@/store/PersistStatus'
import { showToast } from '@/utils/utils'
import {
	inferAudioQualityFromPath,
	normalizeAudioQuality,
	type AudioQuality,
} from '@/helpers/audioQuality'
import { getCachedAudioInfo } from './CacheManager'
import { musicApiSelectedStore, musicApiStore, nowApiState, qualityStore } from './PlayerStore'

export type SourceResult = {
	url: string
	wasCached: boolean
	quality: AudioQuality | null
}

export type ResolveSourceRequestType = 'current' | 'preload'

type ResolveSourceOptions = {
	requestType?: ResolveSourceRequestType
}

type MusicUrlRequestContext = {
	requestKey: string
	requestType: ResolveSourceRequestType
	timeoutMs: number
}

const preloadCache = new Map<string, SourceResult>()
const CURRENT_SOURCE_REQUEST_TIMEOUT_MS = 5000
const PRELOAD_SOURCE_REQUEST_TIMEOUT_MS = 12000

const isCurrentSourceRequest = (requestType: ResolveSourceRequestType) => requestType === 'current'

const getSourceRequestTimeoutMs = (requestType: ResolveSourceRequestType) =>
	isCurrentSourceRequest(requestType)
		? CURRENT_SOURCE_REQUEST_TIMEOUT_MS
		: PRELOAD_SOURCE_REQUEST_TIMEOUT_MS

const getMusicItemSourceKey = (item: IMusic.IMusicItem) =>
	String(item.platform || item.source || 'unknown').replace(/\s+/g, '_')

const createSourceRequestKey = (item: IMusic.IMusicItem, requestType: ResolveSourceRequestType) =>
	`source_${requestType}_${getMusicItemSourceKey(item)}_${item.id}_${Date.now().toString(36)}_${Math.random()
		.toString(36)
		.slice(2, 8)}`

const getSourceRequestLogPrefix = (requestType: ResolveSourceRequestType, requestKey: string) =>
	`[sourceResolver][${requestType}][requestKey=${requestKey}]`

function makePreloadKey(item: IMusic.IMusicItem): string {
	return `${getMusicItemSourceKey(item)}://${item.id}`
}

export const getPreloadedUrl = (item: IMusic.IMusicItem): string | undefined => {
	return preloadCache.get(makePreloadKey(item))?.url
}

export const preloadSource = async (item: IMusic.IMusicItem): Promise<void> => {
	const key = makePreloadKey(item)
	if (preloadCache.has(key)) return
	try {
		const result = await resolveSource(item, { requestType: 'preload' })
		if (result.url && !result.url.includes('fake')) {
			preloadCache.set(key, result)
			if (preloadCache.size > 10) {
				const firstKey = preloadCache.keys().next().value
				if (firstKey) preloadCache.delete(firstKey)
			}
		}
	} catch {
		// preload failures are silent
	}
}

const setQuality = (quality: IMusic.IQualityKey) => {
	qualityStore.setValue(quality)
	PersistStatus.set('music.quality', quality)
}

export const resolveSource = async (
	musicItem: IMusic.IMusicItem,
	options: ResolveSourceOptions = {},
): Promise<SourceResult> => {
	const preloadKey = makePreloadKey(musicItem)
	const requestType = options.requestType ?? 'current'

	const localFile = await resolveLocalFile(musicItem.url)
	if (localFile.status !== 'nonlocal') {
		if (localFile.status !== 'resolved') {
			if (isCurrentSourceRequest(requestType)) {
				logError('本地文件无法访问:', musicItem.url, localFile.reason)
				showToast('错误', '本地文件不存在，请删除并重新缓存或导入。', 'error')
			}
			return { url: fakeAudioMp3Uri, wasCached: false, quality: null }
		}
		preloadCache.delete(preloadKey)
		const wasCached = localFile.fileUri.includes('/musicCache/')
		return {
			url: localFile.fileUri,
			wasCached,
			quality:
				normalizeAudioQuality(musicItem.cachedQuality) ??
				inferAudioQualityFromPath(localFile.fileUri),
		}
	}

	const cached = await getCachedAudioInfo(musicItem)
	if (cached) {
		preloadCache.delete(preloadKey)
		logInfo('使用缓存的音频路径播放:', cached.localPath)
		return { url: cached.localPath, wasCached: true, quality: cached.quality }
	}

	// 只在本地与磁盘缓存都未命中时，才复用预加载的远端音源
	const preloaded = preloadCache.get(preloadKey)
	if (preloaded) {
		logInfo(`[sourceResolver][${requestType}] 使用预加载的音源:`, preloaded.url)
		preloadCache.delete(preloadKey)
		return preloaded
	}

	if (!musicItem.url || musicItem.url === 'Unknown' || musicItem.url.includes('fake')) {
		const nowMusicApi = musicApiSelectedStore.getValue()
		if (nowMusicApi == null) {
			if (isCurrentSourceRequest(requestType)) {
				showToast('错误', '获取音乐失败，请先导入音源。', 'error')
			}
			return { url: fakeAudioMp3Uri, wasCached: false, quality: null }
		}

		const requestKey = createSourceRequestKey(musicItem, requestType)
		const logPrefix = getSourceRequestLogPrefix(requestType, requestKey)
		const timeoutMs = getSourceRequestTimeoutMs(requestType)
		const failureKey = getMusicFailureKey(musicItem)
		const failedIds = getFailedApiIds(failureKey)
		const qualityOrder: IMusic.IQualityKey[] = ['flac', '320k', '128k']
		const apisToTry: IMusic.MusicApi[] = []
		if (!failedIds.has(nowMusicApi.id)) apisToTry.push(nowMusicApi)
		if (isCurrentSourceRequest(requestType)) {
			for (const api of getFailoverCandidates(
				musicApiStore.getValue() || [],
				nowMusicApi.id,
				failedIds,
			)) {
				if (!apisToTry.some((item) => item.id === api.id)) apisToTry.push(api)
			}
		}

		logInfo(`${logPrefix} 开始请求音源: ${musicItem.title} - ${musicItem.artist}`)

		try {
			for (const api of apisToTry.slice(0, MAX_FAILOVER_SOURCES)) {
				let currentQualityIndex = qualityOrder.indexOf(qualityStore.getValue())
				if (currentQualityIndex < 0) currentQualityIndex = qualityOrder.length - 1
				let resp_url: string | null = null
				let resolvedQuality: AudioQuality = null

				while (currentQualityIndex < qualityOrder.length && !resp_url) {
					const currentQuality = qualityOrder[currentQualityIndex]
					try {
						resp_url = await requestMusicUrlFromApi(api, musicItem, currentQuality, timeoutMs, {
							requestKey,
							requestType,
							timeoutMs,
						} as MusicUrlRequestContext)
						if (!resp_url || !isValidMusicUrl(resp_url)) {
							if (isCurrentSourceRequest(requestType)) {
								logInfo(`${logPrefix} ${api.name} ${currentQuality}音质无可用链接，尝试下一个音质`)
							}
							currentQualityIndex++
							resp_url = null
							continue
						}
						resolvedQuality = currentQuality
						if (isCurrentSourceRequest(requestType) && currentQuality !== qualityStore.getValue()) {
							showToast('提示', `已自动切换至${currentQuality}音质`, 'info')
							setQuality(currentQuality)
						}
						logInfo(`${logPrefix} ${api.name} 成功获取${currentQuality}音质的音乐URL:`, resp_url)
					} catch (error) {
						if (isCurrentSourceRequest(requestType)) {
							logInfo(
								`${logPrefix} ${api.name} ${currentQuality}音质无可用链接(catch),尝试下一个音质`,
							)
							const errMsg = error instanceof Error ? error.message : String(error)
							logError(`${logPrefix} (catch error): ${errMsg}`)
						}
						currentQualityIndex++
					}
				}

				if (resp_url) {
					if (isCurrentSourceRequest(requestType) && api.id !== nowMusicApi.id) {
						await setMusicApiAsSelectedById(api.id, { silent: true })
					}
					if (isCurrentSourceRequest(requestType)) {
						nowApiState.setValue('正常')
					}
					logInfo(`${logPrefix} 最终的音乐 URL:`, resp_url)
					return { url: resp_url, wasCached: false, quality: resolvedQuality }
				}

				if (isCurrentSourceRequest(requestType)) {
					rememberFailedApi(failureKey, api.id)
				}
			}

			if (isCurrentSourceRequest(requestType)) {
				nowApiState.setValue('异常')
				throw new Error('无法获取任何音质的音乐，请稍后重试。')
			}
			return { url: fakeAudioMp3Uri, wasCached: false, quality: null }
		} catch (error) {
			if (isCurrentSourceRequest(requestType)) {
				nowApiState.setValue('异常')
			}
			const errMsg = error instanceof Error ? error.message : String(error)
			if (isCurrentSourceRequest(requestType)) {
				logError(`${logPrefix} 获取音乐 URL 失败: ${errMsg}`)
				const errorMessage =
					errMsg === '请求超时'
						? '获取音乐超时，请稍后重试。'
						: errMsg || '获取音乐失败，请稍后重试。'
				showToast(errorMessage, '', 'error')
			}
			return { url: fakeAudioMp3Uri, wasCached: false, quality: null }
		}
	}

	return {
		url: musicItem.url,
		wasCached: false,
		quality:
			normalizeAudioQuality(musicItem.playbackQuality) ??
			normalizeAudioQuality(musicItem.cachedQuality) ??
			inferAudioQualityFromPath(musicItem.url),
	}
}
