import { File, Paths } from 'expo-file-system'
import { createDownloadResumable, FileSystemSessionType } from 'expo-file-system/legacy'
import { logError } from './logger'

export type DownloadProgress = { bytesWritten: number; contentLength: number }
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000
class DownloadIdleTimeoutError extends Error {}
let nextDownloadId = 0
const abortWaiters = new Map<string, () => void>()
const activeDownloads = new Map<string, ReturnType<typeof createDownloadResumable>>()
type ResumeState = { url: string; fileUri: string; resumeData: string; savedAt: number }
let readResume: (id: string) => ResumeState | undefined = () => undefined
let writeResume: (id: string, state?: ResumeState) => void = () => {}
export const configureDownloadResume = (read: typeof readResume, write: typeof writeResume) => {
	readResume = read
	writeResume = write
}
const pausedIds = new Set<string>()
const pauseRequests = new Map<string, Promise<void>>()
export async function pauseDownload(taskId: string) {
	const task = activeDownloads.get(taskId)
	if (!task) return
	if (pauseRequests.has(taskId)) return pauseRequests.get(taskId)
	pausedIds.add(taskId)
	const pending = Promise.resolve().then(async () => {
		const state = await task.pauseAsync()
		if (state.resumeData)
			writeResume(taskId, {
				url: state.url,
				fileUri: state.fileUri,
				resumeData: state.resumeData,
				savedAt: Date.now(),
			})
		abortWaiters.get(taskId)?.()
	})
	pauseRequests.set(taskId, pending)
	try {
		await pending
	} finally {
		pauseRequests.delete(taskId)
	}
}
const isOwnedPartial = (state: ResumeState) => {
	const prefix = new File(Paths.cache, 'cymusic-download-').uri
	return (
		typeof state.fileUri === 'string' &&
		state.fileUri.startsWith(prefix) &&
		/^[a-zA-Z0-9.-]+\.tmp$/.test(state.fileUri.slice(prefix.length))
	)
}
export const discardDownloadResume = (taskId: string) => {
	const state = readResume(taskId)
	writeResume(taskId)
	if (state && isOwnedPartial(state) && Paths.info(state.fileUri).exists)
		new File(state.fileUri).delete()
}
const pendingCancellations = new Set<string>()
export const clearDownloadCancellation = (taskId: string) => {
	pendingCancellations.delete(taskId)
}

export async function cancelDownload(taskId: string): Promise<boolean> {
	pendingCancellations.add(taskId)
	abortWaiters.get(taskId)?.()
	const task = activeDownloads.get(taskId)
	try {
		await pauseRequests.get(taskId)
	} catch {
		/* Cancellation also retires failed pauses. */
	}
	discardDownloadResume(taskId)
	if (!task) return true
	await task.cancelAsync()
	return true
}

/** Keep partial bytes isolated; native resume reconstructs a complete file before commit. */
async function downloadAttempt(
	url: string,
	destinationUri: string,
	onProgress?: (progress: DownloadProgress) => void,
	taskId?: string,
): Promise<void> {
	if (taskId && pendingCancellations.delete(taskId)) throw new Error('下载已取消')
	if (taskId && activeDownloads.has(taskId)) throw new Error('下载任务已在进行中')
	// Keep this string: File.move changes the source File object's URI to the destination.
	const saved = taskId ? readResume(taskId) : undefined
	const resume =
		saved &&
		isOwnedPartial(saved) &&
		typeof saved.resumeData === 'string' &&
		saved.url === url &&
		Date.now() - saved.savedAt < 7 * 86400_000
			? saved
			: undefined
	if (saved && !resume && taskId) discardDownloadResume(taskId)
	const temporaryUri =
		resume?.fileUri ??
		new File(
			Paths.cache,
			`cymusic-download-${Date.now()}-${++nextDownloadId}-${Math.random().toString(36).slice(2)}.tmp`,
		).uri
	let timeout: ReturnType<typeof setTimeout> | undefined
	let lastBytesWritten = 0
	let stopped = false
	let rejectWait: (error: Error) => void = () => {}
	const interrupted = new Promise<never>((_, reject) => {
		rejectWait = reject
	})
	const cancelWait = () => {
		stopped = true
		rejectWait(new Error('下载已取消'))
	}
	const resetIdleTimeout = () => {
		if (timeout !== undefined) clearTimeout(timeout)
		timeout = setTimeout(() => {
			stopped = true
			rejectWait(new DownloadIdleTimeoutError('下载长时间无进度，请检查网络后重试'))
		}, DOWNLOAD_IDLE_TIMEOUT_MS)
	}
	const task = createDownloadResumable(
		url,
		temporaryUri,
		{ sessionType: FileSystemSessionType.FOREGROUND },
		({ totalBytesWritten, totalBytesExpectedToWrite }) => {
			if (stopped) return
			if (totalBytesWritten > lastBytesWritten) {
				lastBytesWritten = totalBytesWritten
				resetIdleTimeout()
			}
			onProgress?.({ bytesWritten: totalBytesWritten, contentLength: totalBytesExpectedToWrite })
		},
		resume?.resumeData,
	)
	if (taskId) {
		activeDownloads.set(taskId, task)
		abortWaiters.set(taskId, cancelWait)
	}
	try {
		resetIdleTimeout()
		const result = await Promise.race([
			resume ? task.resumeAsync() : task.downloadAsync(),
			interrupted,
		])
		if (timeout !== undefined) clearTimeout(timeout)
		if (!result) throw new Error('下载已取消或未返回结果')
		if (result.status !== 200 && !(resume && result.status === 206))
			throw new Error(`下载失败，状态码: ${result.status}`)
		if (taskId && (pendingCancellations.has(taskId) || pausedIds.has(taskId)))
			throw new Error('下载已暂停或取消')
		if (taskId) writeResume(taskId)
		await new File(temporaryUri).move(new File(destinationUri), { overwrite: true })
	} finally {
		if (taskId && pauseRequests.has(taskId)) {
			try {
				await pauseRequests.get(taskId)
			} catch (error) {
				logError('暂停下载失败:', error)
			}
		}
		const retained = taskId && readResume(taskId)?.fileUri === temporaryUri
		stopped = true
		if (timeout !== undefined) clearTimeout(timeout)
		if (taskId && abortWaiters.get(taskId) === cancelWait) abortWaiters.delete(taskId)
		if (taskId && activeDownloads.get(taskId) === task) activeDownloads.delete(taskId)
		// downloadAsync leaves its progress subscription installed, including after success.
		try {
			if (!retained) await task.cancelAsync()
		} catch (error) {
			logError('清理下载任务时出错:', error)
		}
		try {
			if (!retained && Paths.info(temporaryUri).exists) new File(temporaryUri).delete()
		} catch (error) {
			logError('清理下载临时文件时出错:', error)
		}
	}
}

/** Retry a stalled transfer or expired native resume once with a fresh temporary file. */
export async function downloadFile(
	url: string,
	destinationUri: string,
	onProgress?: (progress: DownloadProgress) => void,
	taskId?: string,
): Promise<void> {
	if (taskId) pausedIds.delete(taskId)
	for (let attempt = 0; ; attempt++) {
		try {
			await downloadAttempt(url, destinationUri, onProgress, taskId)
			return
		} catch (error) {
			if (
				taskId &&
				readResume(taskId) &&
				!pausedIds.has(taskId) &&
				!pendingCancellations.has(taskId) &&
				attempt < 1
			) {
				discardDownloadResume(taskId)
				continue
			}
			if (
				(taskId && (readResume(taskId) || pausedIds.has(taskId))) ||
				!(error instanceof DownloadIdleTimeoutError) ||
				attempt >= 1 ||
				(taskId && pendingCancellations.has(taskId))
			)
				throw error
		}
	}
}
