import { musicApiStore } from '@/player/PlayerStore'
import { logError } from '@/helpers/logger'
import { createMusicApiFromScript } from './importMusicSource'
import { addMusicApi, restoreSelectedRuntime, withMusicSourceImport } from './musicApiControl'

export type MusicSourceFile = { name: string; read: () => Promise<string> }
export type MusicSourceImportResult = {
	imported: number
	skipped: number
	failures: { name: string; error: string }[]
	restoreFailed: boolean
}
let nextImportId = 0

/** Import independently so one unreadable/invalid script cannot discard earlier successes. */
export const importMusicSourceFiles = async (
	files: MusicSourceFile[],
	onProgress?: (completed: number, total: number) => void,
): Promise<MusicSourceImportResult> => {
	const result: MusicSourceImportResult = {
		imported: 0,
		skipped: 0,
		failures: [],
		restoreFailed: false,
	}
	try {
		for (const [index, file] of files.entries()) {
			try {
				const script = (await file.read()).trim()
				if (
					script &&
					(musicApiStore.getValue() ?? []).some((api) => api.script?.trim() === script)
				) {
					result.skipped++
				} else {
					const api = await withMusicSourceImport(() => createMusicApiFromScript(script))
					if (!api.id) api.id = `import_${Date.now()}_${++nextImportId}`
					if (!api.name) api.name = file.name.replace(/\.js$/i, '')
					const added = addMusicApi(api, {
						silent: true,
						autoTest: false,
						skipExisting: true,
						throwOnError: true,
					})
					if (added) result.imported++
					else result.skipped++
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				result.failures.push({ name: file.name, error: message })
				logError('Batch music source import failed', file.name, message)
			}
			onProgress?.(index + 1, files.length)
		}
	} finally {
		// LX parsing loads a native runtime; return to the source selected for playback.
		try {
			await restoreSelectedRuntime()
		} catch (error) {
			result.restoreFailed = true
			logError('Failed to restore selected source after batch import', error)
		}
	}
	return result
}
