import * as Network from 'expo-network'
import * as FileSystem from 'expo-file-system/legacy'
import PersistStatus from '@/store/PersistStatus'
import i18n from '@/utils/i18n'
import { showToast } from '@/utils/utils'
import { cancelDownload, clearDownloadCancellation } from '@/helpers/fileDownload'
import { requestAbortError } from '@/helpers/requestControl'
import { fakeAudioMp3Uri } from '@/constants/images'
import { resolveLocalFile } from '@/helpers/localFile'
import {
	getCachedAudioInfo,
	downloadToCache,
	getCacheFileUri,
	getLocalFilePath,
	markSavedOffline,
	migrateCacheRetention,
	enforceAutomaticCacheLimit,
	ensureCacheDiskSpace,
} from './CacheManager'
import { resolveSource } from './MusicSourceResolver'
import {
	autoCacheLocalStore,
	autoCacheWifiOnlyStore,
	cacheDownloadTasksStore,
	importedLocalMusicStore,
	qualityStore,
	CacheDownloadTask,
} from './PlayerStore'
import type { AudioQuality } from '@/helpers/audioQuality'

type DownloadOptions = {
	quality?: AudioQuality
	silent?: boolean
	kind?: 'saved' | 'automatic'
	strictQuality?: boolean
}
const active = new Map<string, AbortController>()
const activeMedia = new Map<string, string>()
const mediaKey = (track: IMusic.IMusicItem) => JSON.stringify([track.platform, track.id])
export const getProtectedDownloadPaths = () =>
	(cacheDownloadTasksStore.getValue() ?? [])
		.filter((task) => task.kind === 'saved' && ['queued', 'downloading'].includes(task.status))
		.flatMap((task) => [
			getLocalFilePath(task.track, 'flac'),
			getLocalFilePath(task.track, '320k'),
			getLocalFilePath(task.track, '128k'),
			...(task.track.url ? [task.track.url] : []),
		])
let protectedPaths = () => [] as string[]
let clearing = false
let cacheMaintenance: Promise<void> = Promise.resolve()
export const configureDownloads = (getProtectedPaths: () => string[]) => {
	protectedPaths = getProtectedPaths
}
const withCacheMaintenance = (work: () => Promise<void>) => {
	const next = cacheMaintenance.then(work, work)
	cacheMaintenance = next.catch(() => {})
	return next
}
let lastProgressSaveAt = 0
const persistTasks = (tasks: CacheDownloadTask[], progressOnly = false) => {
	const pending = tasks.filter((task) =>
		['queued', 'downloading', 'interrupted'].includes(task.status),
	)
	const completed = tasks
		.filter((task) => !['queued', 'downloading', 'interrupted'].includes(task.status))
		.slice(-50)
	const retained = [...pending, ...completed].sort(
		(a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0),
	)
	cacheDownloadTasksStore.setValue(retained)
	const now = Date.now()
	if (!progressOnly || now - lastProgressSaveAt >= 2000) {
		PersistStatus.set('music.cacheDownloads', retained)
		lastProgressSaveAt = now
	}
}
const update = (task: CacheDownloadTask, progressOnly = false) => {
	const tasks = cacheDownloadTasksStore.getValue() ?? []
	const index = tasks.findIndex((item) => item.id === task.id)
	const next = [...tasks]
	if (index < 0) next.push(task)
	else
		next[index] = {
			...task,
			kind:
				tasks[index].runId === task.runId && tasks[index].kind === 'saved' ? 'saved' : task.kind,
			silent:
				tasks[index].runId === task.runId && tasks[index].silent === false ? false : task.silent,
		}
	persistTasks(next, progressOnly)
}
const isCurrent = (task: CacheDownloadTask) =>
	cacheDownloadTasksStore
		.getValue()
		.some(
			(item) => item.id === task.id && item.runId === task.runId && item.status === 'downloading',
		)

export const restoreDownloadTasks = () => {
	const tasks = PersistStatus.get('music.cacheDownloads') ?? []
	if (!Array.isArray(tasks)) return
	const unique = new Map<string, CacheDownloadTask>()
	for (const task of tasks) {
		if (
			!task ||
			typeof task.id !== 'string' ||
			!task.track ||
			typeof task.track.id !== 'string' ||
			typeof task.track.platform !== 'string' ||
			typeof task.track.title !== 'string' ||
			typeof task.track.artist !== 'string' ||
			!['queued', 'downloading', 'interrupted', 'completed', 'failed', 'cancelled'].includes(
				task.status,
			) ||
			!['128k', '320k', 'flac'].includes(task.quality)
		)
			continue
		unique.set(task.id, {
			...task,
			strictQuality: task.strictQuality === true,
			kind: task.kind === 'automatic' ? 'automatic' : 'saved',
			progress: Number.isFinite(task.progress) ? Math.max(0, Math.min(1, task.progress)) : 0,
			status:
				task.status === 'downloading' || task.status === 'queued' ? 'interrupted' : task.status,
		})
	}
	persistTasks([...unique.values()])
}

const run = async (task: CacheDownloadTask, controller: AbortController) => {
	try {
		if (task.kind === 'automatic') {
			if (!autoCacheLocalStore.getValue()) throw new Error('自动缓存已关闭')
			if (
				autoCacheWifiOnlyStore.getValue() &&
				(await Network.getNetworkStateAsync()).type !== Network.NetworkStateType.WIFI
			)
				throw new Error('等待 Wi-Fi 后重试')
		}
		await withCacheMaintenance(migrateCacheRetention)
		const existing = await getCachedAudioInfo(
			task.track,
			!task.strictQuality,
			task.strictQuality ? (task.quality as IMusic.IQualityKey) : undefined,
		)
		let localPath = existing?.localPath
		let quality = existing?.quality ?? task.quality
		if (!localPath) {
			const local = await resolveLocalFile(task.track.url)
			if (local.status !== 'nonlocal' && (!task.strictQuality || task.track.platform === 'local'))
				throw new Error('本地歌曲无需重复下载')
			const source = await resolveSource(
				{ ...task.track, url: 'Unknown' },
				{
					requestType: 'download',
					quality: task.quality as IMusic.IQualityKey,
					strictQuality: task.strictQuality,
					signal: controller.signal,
				},
			)
			if (controller.signal.aborted || !isCurrent(task)) return
			if (!source.url || source.url === fakeAudioMp3Uri || source.url.includes('fake'))
				throw new Error(
					i18n.t(task.strictQuality ? 'downloadQuality.unavailable' : 'downloadQuality.noSource'),
				)
			quality = source.quality ?? task.quality
			if (task.strictQuality && quality !== task.quality)
				throw new Error(i18n.t('downloadQuality.unavailable'))
			await withCacheMaintenance(() =>
				ensureCacheDiskSpace(() => [
					...protectedPaths(),
					...cacheDownloadTasksStore
						.getValue()
						.filter((item) => item.status === 'downloading')
						.map((item) => getLocalFilePath(item.track, item.quality)),
				]),
			)
			if (controller.signal.aborted || !isCurrent(task)) return
			localPath = await downloadToCache(
				{ ...task.track, url: source.url },
				quality,
				(progress) => {
					if (isCurrent(task)) update({ ...task, quality, progress, status: 'downloading' }, true)
				},
				task.id,
				true,
				task.strictQuality,
			)
		}
		if (controller.signal.aborted || !isCurrent(task)) return
		await withCacheMaintenance(async () => {
			if (controller.signal.aborted || !isCurrent(task)) return
			const latest = cacheDownloadTasksStore.getValue().find((item) => item.id === task.id)
			const kind = latest?.kind ?? task.kind ?? 'saved'
			if (kind === 'saved') markSavedOffline(localPath)
			const tracks = importedLocalMusicStore.getValue() ?? []
			const index = tracks.findIndex((track) => track.url === localPath)
			let id = index >= 0 ? tracks[index].id : task.track.id
			if (index < 0 && tracks.some((track) => track.id === id)) {
				const baseId = `cache:${task.track.platform}:${task.track.id}:${quality}`
				id = baseId
				for (let suffix = 2; tracks.some((track) => track.id === id); suffix++)
					id = `${baseId}:${suffix}`
			}
			const record = {
				...task.track,
				id,
				originalId: task.track.id,
				url: localPath,
				cachedQuality: quality,
				cacheKind: kind,
			}
			const updated = [...tracks]
			if (index >= 0) updated[index] = record
			else updated.push(record)
			importedLocalMusicStore.setValue(updated)
			PersistStatus.set('music.importedLocalMusic', updated)
			await enforceAutomaticCacheLimit(protectedPaths)
			const available = await FileSystem.getInfoAsync(getCacheFileUri(localPath))
			if (!available.exists) throw new Error('歌曲超过自动缓存上限，已跳过')
			if (isCurrent(task)) {
				update({ ...task, kind, quality, progress: 1, status: 'completed' })
				if (latest?.silent === false && kind === 'saved')
					showToast(i18n.t('cacheCenter.downloaded'), task.track.title, 'success')
			}
		})
	} catch (error) {
		if (controller.signal.aborted || !isCurrent(task)) return
		update({
			...task,
			status: 'failed',
			error: error instanceof Error ? error.message : String(error),
		})
		if (task.silent === false && task.kind !== 'automatic')
			showToast(
				i18n.t('cacheCenter.downloadFailed'),
				error instanceof Error ? error.message : String(error),
				'error',
			)
	} finally {
		clearDownloadCancellation(task.id)
		if (active.get(task.id) === controller) {
			active.delete(task.id)
			activeMedia.delete(task.id)
		}
		pump()
	}
}

const pump = () => {
	if (clearing) return
	while (active.size < 2) {
		const queued = cacheDownloadTasksStore
			.getValue()
			.find(
				(task) =>
					task.status === 'queued' &&
					!active.has(task.id) &&
					![...activeMedia.values()].includes(mediaKey(task.track)),
			)
		if (!queued) break
		const task: CacheDownloadTask = {
			...queued,
			runId: `${Date.now()}_${Math.random()}`,
			status: 'downloading',
			updatedAt: Date.now(),
		}
		const controller = new AbortController()
		active.set(task.id, controller)
		activeMedia.set(task.id, mediaKey(task.track))
		update(task)
		void run(task, controller)
	}
}

export const enqueueDownload = async (track: IMusic.IMusicItem, options: DownloadOptions = {}) => {
	if (options.strictQuality && typeof track.originalId === 'string' && track.platform !== 'local')
		track = { ...track, id: track.originalId }
	const requestedQuality = options.quality ?? qualityStore.getValue()
	const quality = ['128k', '320k', 'flac'].includes(requestedQuality)
		? requestedQuality
		: qualityStore.getValue()
	const id = JSON.stringify([track.platform || 'unknown', track.id, quality])
	const existing = cacheDownloadTasksStore.getValue().find((task) => task.id === id)
	const kind = options.kind ?? 'saved'
	if (existing && ['downloading', 'queued'].includes(existing.status)) {
		if (options.strictQuality && !existing.strictQuality) {
			await cancelCacheTask(existing.id)
		} else {
			if (kind === 'saved')
				update({ ...existing, kind, silent: options.silent === true && existing.silent !== false })
			if (!options.silent) showToast(i18n.t('cacheCenter.alreadyDownloading'), track.title, 'info')
			return
		}
	}
	update({
		id,
		track,
		kind,
		silent: options.silent === true,
		quality,
		strictQuality: options.strictQuality === true,
		progress: 0,
		status: 'queued',
		updatedAt: Date.now(),
	})
	if (!options.silent) showToast(i18n.t('cacheCenter.queued'), track.title, 'info')
	pump()
}

export const cancelCacheTask = async (taskId: string) => {
	const task = cacheDownloadTasksStore.getValue().find((item) => item.id === taskId)
	if (!task || !['downloading', 'queued', 'interrupted'].includes(task.status)) return
	update({ ...task, status: 'cancelled' })
	active.get(taskId)?.abort(requestAbortError())
	if (active.has(taskId)) await cancelDownload(taskId)
	pump()
}

export const resumeCacheTasks = () => {
	persistTasks(
		cacheDownloadTasksStore
			.getValue()
			.map((task) =>
				task.status === 'interrupted' ? { ...task, status: 'queued', progress: 0 } : task,
			),
	)
	pump()
}

export const clearAutomaticDownloads = async (clearFiles: () => Promise<void>) => {
	clearing = true
	try {
		const tasks = cacheDownloadTasksStore
			.getValue()
			.filter(
				(task) =>
					task.kind === 'automatic' &&
					['downloading', 'queued', 'interrupted'].includes(task.status),
			)
		await Promise.all(tasks.map((task) => cancelCacheTask(task.id)))
		await withCacheMaintenance(clearFiles)
	} finally {
		clearing = false
		pump()
	}
}

export const downloadPlaylist = async (
	tracks: IMusic.IMusicItem[],
	options: Pick<DownloadOptions, 'quality' | 'strictQuality'> = {},
) => {
	const downloadable = [
		...new Map(
			tracks
				.filter((track) => track.platform !== 'local')
				.map((track) => [JSON.stringify([track.platform, track.id]), track]),
		).values(),
	]
	const quality = options.quality ?? qualityStore.getValue()
	for (const track of downloadable)
		await enqueueDownload(track, { ...options, quality, kind: 'saved', silent: true })
	showToast(i18n.t('cacheCenter.batchQueued', { count: downloadable.length }), '', 'info')
}

export const setCacheLimitMB = async (limit: number) => {
	if (![256, 512, 1024, 2048, 4096, 8192].includes(limit)) return
	PersistStatus.set('music.cacheLimitMB', limit)
	await withCacheMaintenance(() => enforceAutomaticCacheLimit(protectedPaths))
}
