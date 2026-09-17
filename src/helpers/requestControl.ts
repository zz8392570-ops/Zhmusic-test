export function requestAbortError() {
	const error = new Error('请求已取消')
	error.name = 'AbortError'
	return error
}

export function throwIfRequestAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : requestAbortError()
}

/** Retire the caller's wait even when a third-party script has no cancellation API. */
export async function waitForRequest<T>(
	work: () => Promise<T>,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<T> {
	throwIfRequestAborted(signal)
	let timer: ReturnType<typeof setTimeout>
	let onAbort: () => void
	const interrupted = new Promise<never>((_, reject) => {
		onAbort = () => {
			try {
				throwIfRequestAborted(signal)
			} catch (error) {
				reject(error)
			}
		}
		signal?.addEventListener('abort', onAbort, { once: true })
		timer = setTimeout(
			() => {
				const error = new Error('请求超时')
				error.name = 'TimeoutError'
				reject(error)
			},
			Math.max(1, timeoutMs),
		)
	})
	try {
		return await Promise.race([
			Promise.resolve().then(() => {
				throwIfRequestAborted(signal)
				return work()
			}),
			interrupted,
		])
	} finally {
		clearTimeout(timer)
		signal?.removeEventListener('abort', onAbort)
	}
}
