import { fakeAudioMp3Uri } from '@/constants/images'
import { resolveLocalFile } from '@/helpers/localFile'
import { logError, logInfo } from '@/helpers/logger'
import { waitForRequest, throwIfRequestAborted } from '@/helpers/requestControl'
import type { SourceLoadingProgress } from './PlayerStore'
import {
	getFailedApiIds,
	getMusicFailureKey,
	rememberFailedApi,
	recordMusicApiAttempt,
	requestMusicUrlFromApi,
	setMusicApiAsSelectedById,
} from '@/helpers/userApi/musicApiControl'
import {
	getFailoverCandidates,
	isValidMusicUrl,
	MAX_FAILOVER_SOURCES,
} from '@/helpers/userApi/musicSourceHealth'
import { showToast } from '@/utils/utils'
import {
	showAutomaticSourceSwitchNotice,
	type AutomaticSourceSwitchReason,
} from '@/utils/sourceSwitchNotice'
import {
	inferAudioQualityFromPath,
	normalizeAudioQuality,
	type AudioQuality,
} from '@/helpers/audioQuality'
import { getCachedAudioInfo, getCacheLocalPath } from './CacheManager'
import { musicApiSelectedStore, musicApiStore, nowApiState, qualityStore } from './PlayerStore'
import {
	appendSourceDiagnostic,
	classifySourceError,
	getSourceErrorMessage,
} from '@/helpers/userApi/sourceDiagnostics'

export type SourceResult = {
	url: string
	wasCached: boolean
	quality: AudioQuality | null
	sourceId?: string
	sourceName?: string
	requestedQuality?: IMusic.IQualityKey
	recoverySteps?: string[]
	requestKey?: string
	urlExpiresAt?: number | null
}

export type ResolveSourceRequestType = 'current' | 'preload' | 'download'

type ResolveSourceOptions = {
	requestType?: ResolveSourceRequestType
	signal?: AbortSignal
	quality?: IMusic.IQualityKey
	totalTimeoutMs?: number
	onProgress?: (progress: SourceLoadingProgress) => void
}

type MusicUrlRequestContext = {
	requestKey: string
	requestType: ResolveSourceRequestType
	timeoutMs: number
}

type PreloadEntry = { result: SourceResult; createdAt: number; expiresAt: number }
const preloadCache = new Map<string, PreloadEntry>()
const CURRENT_SOURCE_REQUEST_TIMEOUT_MS = 5000
const PRELOAD_SOURCE_REQUEST_TIMEOUT_MS = 12000
const DEFAULT_PRELOAD_TTL_MS = 5 * 60 * 1000

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

function makePreloadKey(item: IMusic.IMusicItem, quality = qualityStore.getValue()): string {
	return JSON.stringify([
		getMusicItemSourceKey(item),
		item.id,
		quality,
		musicApiSelectedStore.getValue()?.id,
	])
}

export const getPreloadedUrl = (item: IMusic.IMusicItem): string | undefined => {
	const key = makePreloadKey(item)
	const entry = preloadCache.get(key)
	if (!entry) return undefined
	if (entry.expiresAt <= Date.now()) {
		preloadCache.delete(key)
		return undefined
	}
	return entry.result.url
}

const inferUrlExpiry = (url: string) => {
	try {
		const parsed = new URL(url)
		for (const key of ['expires', 'expire', 'expiration', 'e']) {
			const raw = parsed.searchParams.get(key)
			if (!raw || !/^\d+$/.test(raw)) continue
			const value = Number(raw)
			const milliseconds = value > 10_000_000_000 ? value : value * 1000
			if (milliseconds > Date.now()) return milliseconds
		}
	} catch {
		// The URL has already passed source validation; use a conservative TTL.
	}
	return Date.now() + DEFAULT_PRELOAD_TTL_MS
}

export const clearPreloadedSources = () => preloadCache.clear()

export const preloadSource = async (item: IMusic.IMusicItem): Promise<void> => {
	const key = makePreloadKey(item)
	if (preloadCache.has(key)) return
	try {
		const result = await resolveSource(item, { requestType: 'preload' })
		if (result.url && !result.url.includes('fake')) {
			const expiresAt = result.urlExpiresAt ?? inferUrlExpiry(result.url)
			preloadCache.set(key, {
				result: { ...result, urlExpiresAt: expiresAt },
				createdAt: Date.now(),
				expiresAt,
			})
			if (preloadCache.size > 10) {
				const firstKey = preloadCache.keys().next().value
				if (firstKey) preloadCache.delete(firstKey)
			}
		}
	} catch {
		// preload failures are silent
	}
}

const resolveSourceInternal = async (
	musicItem: IMusic.IMusicItem,
	options: ResolveSourceOptions = {},
): Promise<SourceResult> => {
	const requestType = options.requestType ?? 'current'
	const preferredQuality = options.quality ?? qualityStore.getValue()
	const preloadKey = makePreloadKey(musicItem, preferredQuality)
	throwIfRequestAborted(options.signal)

	const localFile = await resolveLocalFile(musicItem.url)
	throwIfRequestAborted(options.signal)
	if (localFile.status !== 'nonlocal') {
		if (localFile.status !== 'resolved') {
			if (isCurrentSourceRequest(requestType)) {
				logError('本地文件无法访问:', musicItem.url, localFile.reason)
				showToast('错误', '本地文件不存在，请删除并重新缓存或导入。', 'error')
			}
			return { url: fakeAudioMp3Uri, wasCached: false, quality: null }
		}
		preloadCache.delete(preloadKey)
		const cachePath = localFile.fileUri.includes('/musicCache/')
			? await getCacheLocalPath(localFile.fileUri)
			: null
		throwIfRequestAborted(options.signal)
		const wasCached = cachePath !== null
		return {
			url: cachePath ?? localFile.fileUri,
			wasCached,
			quality:
				normalizeAudioQuality(musicItem.cachedQuality) ??
				inferAudioQualityFromPath(localFile.fileUri),
		}
	}

	const cached = await getCachedAudioInfo(musicItem)
	throwIfRequestAborted(options.signal)
	if (cached) {
		preloadCache.delete(preloadKey)
		logInfo('使用缓存的音频路径播放:', cached.localPath)
		return { url: cached.localPath, wasCached: true, quality: cached.quality }
	}

	// 只在本地与磁盘缓存都未命中时，才复用预加载的远端音源
	const preloadedEntry = requestType === 'download' ? undefined : preloadCache.get(preloadKey)
	const preloaded =
		preloadedEntry && preloadedEntry.expiresAt > Date.now() ? preloadedEntry.result : undefined
	if (preloadedEntry && !preloaded) preloadCache.delete(preloadKey)
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
		const recoverySteps: string[] = []
		let selectedSourceFailureReason: AutomaticSourceSwitchReason = 'noPlayableUrl'
		if (!failedIds.has(nowMusicApi.id)) apisToTry.push(nowMusicApi)
		if (requestType !== 'preload') {
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
				throwIfRequestAborted(options.signal)
				let currentQualityIndex = qualityOrder.indexOf(preferredQuality)
				if (currentQualityIndex < 0) currentQualityIndex = qualityOrder.length - 1
				let resp_url: string | null = null
				let resolvedQuality: AudioQuality = null
				let apiFailureReason: AutomaticSourceSwitchReason = 'noPlayableUrl'

				while (currentQualityIndex < qualityOrder.length && !resp_url) {
					throwIfRequestAborted(options.signal)
					const currentQuality = qualityOrder[currentQualityIndex]
					options.onProgress?.({
						stage:
							api.id !== nowMusicApi.id
								? 'switching'
								: currentQuality !== preferredQuality
									? 'retryingQuality'
									: 'resolving',
						sourceName: api.name,
						quality: currentQuality,
					})
					const attemptCount =
						api.id === nowMusicApi.id && currentQuality === preferredQuality ? 2 : 1
					for (let attemptNumber = 1; attemptNumber <= attemptCount && !resp_url; attemptNumber++) {
						const startedAt = Date.now()
						const step = `${api.id === nowMusicApi.id ? 'selected' : 'failover'}:${currentQuality}:attempt-${attemptNumber}`
						recoverySteps.push(step)
						try {
							resp_url = await requestMusicUrlFromApi(
								api,
								musicItem,
								currentQuality,
								timeoutMs,
								{ requestKey, requestType, timeoutMs } as MusicUrlRequestContext,
								options.signal,
							)
							throwIfRequestAborted(options.signal)
							if (!resp_url || !isValidMusicUrl(resp_url)) {
								const error = new Error('音源未返回可播放链接')
								recordMusicApiAttempt(api.id, {
									success: false,
									durationMs: Date.now() - startedAt,
									quality: currentQuality,
									error,
								})
								appendSourceDiagnostic({
									requestKey,
									requestType,
									track: { id: String(musicItem.id), title: musicItem.title, artist: musicItem.artist, platform: musicItem.platform },
									sourceId: api.id,
									sourceName: api.name,
									requestedQuality: currentQuality,
									step,
									durationMs: Date.now() - startedAt,
									result: 'failure',
									category: 'invalid-url',
									message: error.message,
								})
								resp_url = null
								continue
							}
							recordMusicApiAttempt(api.id, {
								success: true,
								durationMs: Date.now() - startedAt,
								quality: currentQuality,
							})
							resolvedQuality = currentQuality
							appendSourceDiagnostic({
								requestKey,
								requestType,
								track: { id: String(musicItem.id), title: musicItem.title, artist: musicItem.artist, platform: musicItem.platform },
								sourceId: api.id,
								sourceName: api.name,
								requestedQuality: preferredQuality,
								actualQuality: currentQuality,
								step,
								durationMs: Date.now() - startedAt,
								result: 'success',
							})
							if (isCurrentSourceRequest(requestType) && currentQuality !== preferredQuality) {
								showToast('提示', `已自动切换至${currentQuality}音质`, 'info')
							}
							logInfo(`${logPrefix} ${api.name} 成功获取${currentQuality}音质的音乐URL`)
						} catch (error) {
							throwIfRequestAborted(options.signal)
							const errMsg = error instanceof Error ? error.message : String(error)
							apiFailureReason = /timeout|timed out|超时/i.test(errMsg) ? 'timeout' : 'requestFailed'
							recordMusicApiAttempt(api.id, {
								success: false,
								durationMs: Date.now() - startedAt,
								quality: currentQuality,
								error,
							})
							appendSourceDiagnostic({
								requestKey,
								requestType,
								track: { id: String(musicItem.id), title: musicItem.title, artist: musicItem.artist, platform: musicItem.platform },
								sourceId: api.id,
								sourceName: api.name,
								requestedQuality: currentQuality,
								step,
								durationMs: Date.now() - startedAt,
								result: 'failure',
								category: classifySourceError(error),
								message: errMsg,
							})
							if (isCurrentSourceRequest(requestType)) logError(`${logPrefix} ${step}: ${errMsg}`)
						}
					}
					if (!resp_url) currentQualityIndex++
				}

				if (resp_url) {
					throwIfRequestAborted(options.signal)
					if (isCurrentSourceRequest(requestType) && api.id !== nowMusicApi.id) {
						const switchedSource = await setMusicApiAsSelectedById(api.id, {
							silent: true,
							notify: false,
							signal: options.signal,
						})
						throwIfRequestAborted(options.signal)
						if (switchedSource) {
							showAutomaticSourceSwitchNotice({
								fromSource: nowMusicApi.name,
								toSource: api.name,
								reason: selectedSourceFailureReason,
								songTitle: musicItem.title,
							})
						}
					}
					if (isCurrentSourceRequest(requestType)) {
						nowApiState.setValue('正常')
					}
					logInfo(`${logPrefix} 最终的音乐 URL:`, resp_url)
					return {
						url: resp_url,
						wasCached: false,
						quality: resolvedQuality,
						sourceId: api.id,
						sourceName: api.name,
						requestedQuality: preferredQuality,
						recoverySteps,
						requestKey,
						urlExpiresAt: inferUrlExpiry(resp_url),
					}
				}

				if (isCurrentSourceRequest(requestType)) {
					rememberFailedApi(failureKey, api.id)
					if (api.id === nowMusicApi.id) selectedSourceFailureReason = apiFailureReason
				}
			}

			if (isCurrentSourceRequest(requestType)) {
				nowApiState.setValue('异常')
				throw new Error('无法获取任何音质的音乐，请稍后重试。')
			}
			return { url: fakeAudioMp3Uri, wasCached: false, quality: null }
		} catch (error) {
			throwIfRequestAborted(options.signal)
			if (isCurrentSourceRequest(requestType)) {
				nowApiState.setValue('异常')
			}
			const errMsg = error instanceof Error ? error.message : String(error)
			if (isCurrentSourceRequest(requestType)) {
				logError(`${logPrefix} 获取音乐 URL 失败: ${errMsg}`)
				const errorMessage = getSourceErrorMessage(classifySourceError(error))
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

export const resolveSource = async (
	musicItem: IMusic.IMusicItem,
	options: ResolveSourceOptions = {},
): Promise<SourceResult> => {
	const controller = new AbortController()
	const onAbort = () => controller.abort(options.signal?.reason)
	throwIfRequestAborted(options.signal)
	options.signal?.addEventListener('abort', onAbort, { once: true })
	const totalTimeoutMs = options.totalTimeoutMs ?? 20_000
	const timer = setTimeout(() => {
		const error = new Error('获取音源超时，请换源或重试')
		error.name = 'TimeoutError'
		controller.abort(error)
	}, totalTimeoutMs)
	try {
		return await waitForRequest(
			() => resolveSourceInternal(musicItem, { ...options, signal: controller.signal }),
			totalTimeoutMs,
			controller.signal,
		)
	} finally {
		clearTimeout(timer)
		options.signal?.removeEventListener('abort', onAbort)
	}
}
