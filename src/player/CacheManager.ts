import { logError, logInfo } from '@/helpers/logger'
import { cacheRevisionStore, importedLocalMusicStore, qualityStore } from './PlayerStore'
import PersistStatus from '@/store/PersistStatus'
import * as FileSystem from 'expo-file-system/legacy'
import { downloadFile } from '@/helpers/fileDownload'
import { fileUriFromPath } from '@/helpers/localFile'
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

export const clearCache = async () => {
	const dirInfo = await FileSystem.getInfoAsync(cacheDir)
	if (dirInfo.exists) {
		await FileSystem.deleteAsync(cacheDir, { idempotent: true })
		const importedLocalMusic = importedLocalMusicStore.getValue() || []
		const updatedImportedLocalMusic = importedLocalMusic.filter(
			(item: IMusic.IMusicItem) => !String(item.url || '').includes('/musicCache/'),
		)
		importedLocalMusicStore.setValue(updatedImportedLocalMusic)
		PersistStatus.set('music.importedLocalMusic', updatedImportedLocalMusic)
		logInfo('缓存已清理')
	} else {
		logInfo('缓存目录不存在，无需清理')
	}
	PersistStatus.set('music.cacheQualityMap', {})
	cacheRevisionStore.setValue(cacheRevisionStore.getValue() + 1)
}

export { cacheDir }
