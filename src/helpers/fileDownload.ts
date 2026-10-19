import { File, Paths } from 'expo-file-system'
import { createDownloadResumable, FileSystemSessionType } from 'expo-file-system/legacy'
import { logError } from './logger'

type DownloadProgress = { bytesWritten: number; contentLength: number }
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000
class DownloadIdleTimeoutError extends Error {}
let nextDownloadId = 0
const abortWaiters = new Map<string, () => void>()
const activeDownloads = new Map<string, ReturnType<typeof createDownloadResumable>>()
const pendingCancellations = new Set<string>()
export const clearDownloadCancellation = (taskId: string) => {
	pendingCancellations.delete(taskId)
}

export async function cancelDownload(taskId: string): Promise<boolean> {
	pendingCancellations.add(taskId)
	abortWaiters.get(taskId)?.()
	const task = activeDownloads.get(taskId)
	if (!task) return true
	await task.cancelAsync()
	return true
}

/** Download into an isolated file and commit only an actual HTTP 200 response. */
async function downloadAttempt(
	url: string,
	destinationUri: string,
	onProgress?: (progress: DownloadProgress) => void,
	taskId?: string,
): Promise<void> {
	if (taskId && pendingCancellations.delete(taskId)) throw new Error('下载已取消')
	if (taskId && activeDownloads.has(taskId)) throw new Error('下载任务已在进行中')
	// Keep this string: File.move changes the source File object's URI to the destination.
	const temporaryUri = new File(
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
			if (totalBytesExpectedToWrite > 0) {
				onProgress?.({ bytesWritten: totalBytesWritten, contentLength: totalBytesExpectedToWrite })
			}
		},
	)
	if (taskId) {
		activeDownloads.set(taskId, task)
		abortWaiters.set(taskId, cancelWait)
	}
	try {
		resetIdleTimeout()
		const result = await Promise.race([task.downloadAsync(), interrupted])
		if (timeout !== undefined) clearTimeout(timeout)
		if (!result) throw new Error('下载已取消或未返回结果')
		if (result.status !== 200) throw new Error(`下载失败，状态码: ${result.status}`)
		if (taskId && pendingCancellations.has(taskId)) throw new Error('下载已取消')
		await new File(temporaryUri).move(new File(destinationUri), { overwrite: true })
	} finally {
		stopped = true
		if (timeout !== undefined) clearTimeout(timeout)
		if (taskId && abortWaiters.get(taskId) === cancelWait) abortWaiters.delete(taskId)
		if (taskId && activeDownloads.get(taskId) === task) activeDownloads.delete(taskId)
		// downloadAsync leaves its progress subscription installed, including after success.
		try {
			await task.cancelAsync()
		} catch (error) {
			logError('清理下载任务时出错:', error)
		}
		try {
			if (Paths.info(temporaryUri).exists) new File(temporaryUri).delete()
		} catch (error) {
			logError('清理下载临时文件时出错:', error)
		}
	}
}

/** Retry a stalled transfer once, always using a fresh temporary file. */
export async function downloadFile(
	url: string,
	destinationUri: string,
	onProgress?: (progress: DownloadProgress) => void,
	taskId?: string,
): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await downloadAttempt(url, destinationUri, onProgress, taskId)
			return
		} catch (error) {
			if (
				!(error instanceof DownloadIdleTimeoutError) ||
				attempt >= 1 ||
				(taskId && pendingCancellations.has(taskId))
			)
				throw error
		}
	}
}
