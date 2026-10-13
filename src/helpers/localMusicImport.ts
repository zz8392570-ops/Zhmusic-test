import * as FileSystem from 'expo-file-system/legacy'
import { Buffer } from 'buffer'
import FileSystemNative from '../../modules/cymusic-native'
import { importedLocalMusicStore } from '@/player/PlayerStore'
import PersistStatus from '@/store/PersistStatus'
import { isSameMediaItem } from '@/utils/mediaItem'
import { fileUriFromPath, resolveLocalFile } from './localFile'
import { logError } from './logger'

export type LocalMusicImportResult = {
	status: 'success' | 'partial' | 'empty' | 'error'
	imported: number
	skipped: number
	failures: { id: string; name: string; reason: 'copy' | 'storage'; cleanupFailed?: boolean }[]
}

// Import batches share one writer so they cannot choose the same destination or
// replace each other's library snapshot while a copy is awaiting native I/O.
let pendingImports: Promise<void> = Promise.resolve()

const currentLibrary = () =>
	PersistStatus.get('music.importedLocalMusic') || importedLocalMusicStore.getValue() || []

const safePart = (value: string, fallback: string) => {
	let name =
		Array.from(String(value || fallback), (character) => {
			const code = character.codePointAt(0)!
			return code < 32 || code === 127 ? '-' : character
		})
			.join('')
			.replace(/[/\\?%*:|"<>]/g, '-')
			.replace(/^[.\s]+|[.\s]+$/g, '') || fallback
	// Leave room for the artist, extension and collision suffix under the native
	// filename limit. Remove whole code points so Chinese and emoji remain valid.
	while (Buffer.byteLength(name, 'utf8') > 80) name = Array.from(name).slice(0, -1).join('')
	return name
}

async function unusedDestination(item: IMusic.IMusicItem, directory: string, source: string) {
	const extension =
		String(item.format || source.match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'mp3')
			.replace(/[^a-z0-9]/gi, '')
			.slice(0, 8)
			.toLowerCase() || 'mp3'
	const name = `${safePart(item.title, 'track')}-${safePart(item.artist, 'artist')}`
	for (let suffix = 0; suffix < 10_000; suffix++) {
		const path = `${directory}/${name}${suffix ? ` (${suffix + 1})` : ''}.${extension}`
		if (!(await FileSystemNative.exists(path))) return path
	}
	throw new Error('No unused import filename')
}

async function removeUnregisteredCopy(path: string) {
	try {
		if (!(await FileSystemNative.exists(path))) return true
		const local = await resolveLocalFile(path, { requireOwnedMedia: true })
		if (local.status !== 'resolved') return false
		await FileSystem.deleteAsync(local.fileUri, { idempotent: true })
		return true
	} catch (error) {
		logError('清理未登记的导入副本失败:', error)
		return false
	}
}

async function importBatch(items: IMusic.IMusicItem[], copyToLibrary: boolean) {
	const result: LocalMusicImportResult = { status: 'empty', imported: 0, skipped: 0, failures: [] }
	for (const [index, original] of items.entries()) {
		let destination: string | undefined
		let phase: 'copy' | 'storage' = 'storage'
		let registrationUnknown = false
		try {
			if (currentLibrary().some((item) => isSameMediaItem(item, original))) {
				result.skipped++
				continue
			}
			phase = 'copy'
			let imported = { ...original }
			if (copyToLibrary) {
				const source = await resolveLocalFile(original.url)
				if (source.status !== 'resolved') throw new Error('Import source unavailable')
				const directory = `${FileSystemNative.documentDirectoryPath}/importedLocalMusic`
				await FileSystem.makeDirectoryAsync(fileUriFromPath(directory), { intermediates: true })
				if ((await FileSystemNative.stat(directory)) !== 'directory')
					throw new Error('Import directory is not a plain directory')
				destination = await unusedDestination(original, directory, source.filePath)
				await FileSystem.copyAsync({ from: source.fileUri, to: fileUriFromPath(destination) })
				imported = { ...original, url: destination }
			}

			// Read again after the copy so cache registration and deletion during I/O survive.
			const latest = currentLibrary()
			if (latest.some((item) => isSameMediaItem(item, original))) {
				if (destination && !(await removeUnregisteredCopy(destination)))
					throw new Error('Duplicate import copy cleanup failed')
				result.skipped++
				continue
			}
			const next = [...latest, imported]
			phase = 'storage'
			try {
				PersistStatus.set('music.importedLocalMusic', next)
			} catch (error) {
				// A storage listener may throw after the durable write. Never remove a
				// copied file when the saved library already owns it.
				let stored: IMusic.IMusicItem[] | null
				try {
					stored = PersistStatus.get('music.importedLocalMusic')
				} catch {
					registrationUnknown = true
					throw error
				}
				if (!stored?.some((item) => isSameMediaItem(item, imported) && item.url === imported.url))
					throw error
				logError('导入记录已保存，存储通知失败:', error)
			}
			try {
				importedLocalMusicStore.setValue(next)
			} catch (error) {
				// Persistence remains the source of truth even if a UI listener fails.
				logError('导入记录已保存，列表通知失败:', error)
			}
			result.imported++
		} catch (error) {
			const cleanedUp =
				!destination || (!registrationUnknown && (await removeUnregisteredCopy(destination)))
			result.failures.push({
				id: original.id,
				name: String(original.genre || original.title || original.id),
				reason: phase,
				...(!cleanedUp ? { cleanupFailed: true } : {}),
			})
			logError('导入本地歌曲失败:', error)
			if (registrationUnknown) {
				for (const remaining of items.slice(index + 1)) {
					result.failures.push({
						id: remaining.id,
						name: String(remaining.genre || remaining.title || remaining.id),
						reason: 'storage',
					})
				}
				break
			}
		}
	}
	result.status = result.failures.length
		? result.imported
			? 'partial'
			: 'error'
		: result.imported
			? 'success'
			: 'empty'
	return result
}

/** Copy picker files without changing their source; register each completed file independently. */
export function importLocalMusic(items: IMusic.IMusicItem[], copyToLibrary = true) {
	const snapshot = items.map((item) => ({ ...item }))
	const operation = pendingImports.then(() => importBatch(snapshot, copyToLibrary))
	pendingImports = operation.then(
		() => undefined,
		() => undefined,
	)
	return operation
}
