import { logError, logInfo } from '@/helpers/logger'
import { cacheRevisionStore, importedLocalMusicStore, qualityStore } from './PlayerStore'
import PersistStatus from '@/store/PersistStatus'
import * as FileSystem from 'expo-file-system/legacy'
import { downloadFile } from '@/helpers/fileDownload'
import { fileUriFromPath } from '@/helpers/localFile'
import { resolveLocalFile } from '@/helpers/localFile'
import FileSystemNative from '../../modules/cymusic-native'
import {
	inferAudioQualityFromPath,
	normalizeAudioQuality,
	type AudioQuality,
} from '@/helpers/audioQuality'

const cacheDir = FileSystem.documentDirectory + 'musicCache/'
const cacheDirectoryPath = `${FileSystemNative.documentDirectoryPath}/musicCache`

function sanitizeFilename(str: string): string {
	return str.replace(/[/\\?%*:|"<>]/g, '-')
}

export const ensureCacheDirExists = async () => {
	const dirInfo = await FileSystem.getInfoAsync(cacheDir)
	if (!dirInfo.exists) {
		await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true })
	}
}

export const ensureDirExists = async (dirPath: string) => {
	const dirInfo = await FileSystem.getInfoAsync(dirPath)
	if (!dirInfo.exists) {
		await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true })
	}
}

const getCacheExtension = (quality: AudioQuality) =>
	quality === 'flac' || quality === 'flac24bit' ? 'flac' : 'mp3'

const getCacheFilename = (musicItem: IMusic.IMusicItem, quality: AudioQuality): string => {
	const format = getCacheExtension(quality)
	const safeTitle = sanitizeFilename(musicItem.title)
	const safeArtist = sanitizeFilename(musicItem.artist)
	const platformId =
		musicItem.platform && musicItem.id
			? `${musicItem.platform}_${musicItem.id}`
			: `${safeTitle}-${safeArtist}`
	return `${platformId}.${format}`
}

const getLegacyCacheFilename = (musicItem: IMusic.IMusicItem, quality: AudioQuality): string => {
	const safeTitle = sanitizeFilename(musicItem.title)
	const safeArtist = sanitizeFilename(musicItem.artist)
	return `${safeTitle}-${safeArtist}.${getCacheExtension(quality)}`
}

export const getLocalFilePath = (
	musicItem: IMusic.IMusicItem,
	quality: AudioQuality = qualityStore.getValue(),
): string => `${cacheDir}${getCacheFilename(musicItem, quality)}`

const getCacheQualityMap = () => PersistStatus.get('music.cacheQualityMap') ?? {}

export const setCachedQuality = (localPath: string, quality: AudioQuality) => {
	const cacheKey = localPath.slice(cacheDir.length)
	PersistStatus.set('music.cacheQualityMap', {
		...getCacheQualityMap(),
		[cacheKey]: quality,
	})
	cacheRevisionStore.setValue(cacheRevisionStore.getValue() + 1)
}

// Only accepts paths produced by getLocalFilePath. The filename is raw text,
// while cacheDir is an Expo URI; decoding the whole string would change %/# names.
export const getCacheFileUri = (localPath: string): string =>
	fileUriFromPath(`${cacheDirectoryPath}/${localPath.slice(cacheDir.length)}`)

export type CachedAudioInfo = {
	localPath: string
	quality: AudioQuality
}

/** Resolve a cache reference using the owned-media rules, including previous app containers. */
export const getCacheLocalPath = async (value: unknown): Promise<string | null> => {
	const local = await resolveLocalFile(value, { requireOwnedMedia: true })
	if (
		local.status !== 'resolved' ||
		local.filePath
			.slice(0, local.filePath.lastIndexOf('/'))
			.replace(/^\/private(?=\/var\/)/, '') !==
			cacheDirectoryPath.replace(/^\/private(?=\/var\/)/, '')
	)
		return null
	return `${cacheDir}${local.filePath.split('/').pop()}`
}

export const getCachedAudioInfo = async (
	musicItem: IMusic.IMusicItem,
	includeOtherFormats = false,
): Promise<CachedAudioInfo | null> => {
	const preferredQuality = normalizeAudioQuality(musicItem.cachedQuality) ?? qualityStore.getValue()
	const qualityCandidates: AudioQuality[] = includeOtherFormats
		? [preferredQuality, 'flac', '320k']
		: [preferredQuality]
	const paths = Array.from(
		new Set(
			qualityCandidates.flatMap((quality) => [
				getLocalFilePath(musicItem, quality),
				`${cacheDir}${getLegacyCacheFilename(musicItem, quality)}`,
			]),
		),
	)
	const referencedCache = await getCacheLocalPath(musicItem.url)
	if (referencedCache) paths.unshift(referencedCache)
	const qualityMap = getCacheQualityMap()

	for (const localPath of paths) {
		const fileInfo = await FileSystem.getInfoAsync(getCacheFileUri(localPath))
		if (!fileInfo.exists) continue
		const cacheKey = localPath.slice(cacheDir.length)
		const quality =
			normalizeAudioQuality(qualityMap[cacheKey]) ??
			inferAudioQualityFromPath(localPath) ??
			'unknown'
		return { localPath, quality }
	}
	return null
}

export const getCachedQuality = async (musicItem: IMusic.IMusicItem) =>
	(await getCachedAudioInfo(musicItem, true))?.quality ?? null

export const isCached = async (musicItem: IMusic.IMusicItem): Promise<boolean> =>
	(await getCachedAudioInfo(musicItem)) !== null

export const downloadToCache = async (
	musicItem: IMusic.IMusicItem,
	quality: AudioQuality = qualityStore.getValue(),
	onProgress?: (progress: number) => void,
	taskId?: string,
): Promise<string> => {
	try {
		await ensureCacheDirExists()
		const localPath = getLocalFilePath(musicItem, quality)
		const existing = await FileSystem.getInfoAsync(getCacheFileUri(localPath))
		if (existing.exists) {
			setCachedQuality(localPath, quality)
			onProgress?.(1)
			return localPath
		}
		await downloadFile(
			musicItem.url,
			getCacheFileUri(localPath),
			(res) => {
				const progress = res.bytesWritten / res.contentLength
				onProgress?.(progress)
				logInfo(`下载进度: ${(progress * 100).toFixed(2)}%`)
			},
			taskId,
		)
		setCachedQuality(localPath, quality)
		logInfo('音频文件已缓存到本地:', localPath)
		return localPath
	} catch (error) {
		logError('下载音频文件时出错:', error)
		throw error
	}
}

export const getCacheSize = async () => {
	const dirInfo = await FileSystem.getInfoAsync(cacheDir)
	if (!dirInfo.exists) return 0
	const entries = await FileSystem.readDirectoryAsync(cacheDir)
	const files = await Promise.all(
		entries.map((entry) => FileSystem.getInfoAsync(`${cacheDir}${encodeURIComponent(entry)}`)),
	)
	return files.reduce(
		(total, info) => total + (info.exists && !info.isDirectory ? info.size ?? 0 : 0),
		0,
	)
}

export const markSavedOffline = (localPath: string) => {
	if (!localPath.startsWith(cacheDir)) throw new Error('Invalid cache address')
	const key = localPath.slice(cacheDir.length)
	if (!key || key.includes('/') || key.includes('\\') || key === '.' || key === '..')
		throw new Error('Invalid cache filename')
	PersistStatus.set('music.savedOffline', {
		...(PersistStatus.get('music.savedOffline') ?? {}),
		[key]: true,
	})
	cacheRevisionStore.setValue(cacheRevisionStore.getValue() + 1)
}

/** Called after an explicitly selected owned file has been removed. */
export const forgetCachedFile = (filePath: string) => {
	if (
		filePath.slice(0, filePath.lastIndexOf('/')).replace(/^\/private(?=\/var\/)/, '') !==
		cacheDirectoryPath.replace(/^\/private(?=\/var\/)/, '')
	)
		return
	const key = filePath.split('/').pop()!
	const saved = { ...(PersistStatus.get('music.savedOffline') ?? {}) }
	const quality = { ...getCacheQualityMap() }
	delete saved[key]
	delete quality[key]
	PersistStatus.set('music.savedOffline', saved)
	PersistStatus.set('music.cacheQualityMap', quality)
	cacheRevisionStore.setValue(cacheRevisionStore.getValue() + 1)
}

/** Older versions did not distinguish downloads from automatic cache. Retain them. */
export const migrateCacheRetention = async () => {
	const saved = { ...(PersistStatus.get('music.savedOffline') ?? {}) }
	let changed = false
	for (const track of importedLocalMusicStore.getValue() ?? []) {
		if (track.cacheKind === 'automatic' || !String(track.url ?? '').includes('/musicCache/'))
			continue
		const local = await resolveLocalFile(track.url, { requireOwnedMedia: true })
		if (local.status === 'resolved') {
			const key = local.filePath.split('/').pop()
			if (key && !saved[key]) {
				saved[key] = true
				changed = true
			}
		}
	}
	if (changed) PersistStatus.set('music.savedOffline', saved)
}

const removeAutomaticCacheFile = async (
	entry: string,
	isProtected: () => boolean = () => false,
) => {
	if (isProtected()) return false
	if (isProtected() || (PersistStatus.get('music.savedOffline') ?? {})[entry]) return false
	const localPath = `${cacheDir}${entry}`
	const local = await resolveLocalFile(getCacheFileUri(localPath), { requireOwnedMedia: true })
	if (local.status !== 'resolved') return false
	// Recheck retention after asynchronous resolution. A concurrent manual save wins.
	if ((PersistStatus.get('music.savedOffline') ?? {})[entry]) return false
	await FileSystem.deleteAsync(local.fileUri, { idempotent: true })
	const updated = (importedLocalMusicStore.getValue() ?? []).filter(
		(track) =>
			track.url !== localPath && track.url !== local.fileUri && track.url !== local.filePath,
	)
	importedLocalMusicStore.setValue(updated)
	PersistStatus.set('music.importedLocalMusic', updated)
	const quality = { ...getCacheQualityMap() }
	delete quality[entry]
	PersistStatus.set('music.cacheQualityMap', quality)
	cacheRevisionStore.setValue(cacheRevisionStore.getValue() + 1)
	return true
}

type ProtectedCachePaths = string[] | (() => string[])
const isPreserved = (entry: string, paths: ProtectedCachePaths) =>
	(typeof paths === 'function' ? paths() : paths).some(
		(value) => value === `${cacheDir}${entry}` || value === getCacheFileUri(`${cacheDir}${entry}`),
	)

export const enforceAutomaticCacheLimit = async (preservePaths: ProtectedCachePaths = []) => {
	const dirInfo = await FileSystem.getInfoAsync(cacheDir)
	if (!dirInfo.exists) return
	const saved = PersistStatus.get('music.savedOffline') ?? {}
	const entries = (await FileSystem.readDirectoryAsync(cacheDir)).filter((entry) => !saved[entry])
	const files = await Promise.all(
		entries.map(async (entry) => ({
			entry,
			info: await FileSystem.getInfoAsync(getCacheFileUri(`${cacheDir}${entry}`)),
		})),
	)
	let total = files.reduce(
		(bytes, file) => bytes + (file.info.exists && !file.info.isDirectory ? file.info.size ?? 0 : 0),
		0,
	)
	const configuredLimit = PersistStatus.get('music.cacheLimitMB')
	const limit =
		(configuredLimit && [256, 512, 1024, 2048].includes(configuredLimit) ? configuredLimit : 1024) *
		1024 *
		1024
	files.sort(
		(a, b) =>
			(a.info.exists ? a.info.modificationTime ?? 0 : 0) -
			(b.info.exists ? b.info.modificationTime ?? 0 : 0),
	)
	for (const file of files) {
		if (total <= limit) break
		if (await removeAutomaticCacheFile(file.entry, () => isPreserved(file.entry, preservePaths)))
			total -= file.info.exists && !file.info.isDirectory ? file.info.size ?? 0 : 0
	}
}

export const clearCache = async (preservePaths: ProtectedCachePaths = []) => {
	await migrateCacheRetention()
	if (!(await FileSystem.getInfoAsync(cacheDir)).exists) return
	for (const entry of await FileSystem.readDirectoryAsync(cacheDir)) {
		await removeAutomaticCacheFile(entry, () => isPreserved(entry, preservePaths))
	}
	logInfo('自动缓存已清理，离线保存已保留')
}

export { cacheDir }
