import { createStore, useStore } from 'zustand'

type LogLevel = 'INFO' | 'WARN' | 'ERROR'
export const MAX_LOG_ENTRIES = 1000

export type LogEntry = {
	timestamp: string
	level: LogLevel
	message: string
	details?: string
}

interface LoggerState {
	logs: LogEntry[]
	addLog: (level: LogLevel, ...args: unknown[]) => void
	clearLogs: () => void
}

export const MAX_LOG_MESSAGE_LENGTH = 8192
const sensitiveKey =
	/^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|credential|signature)$/i
const redactText = (text: string) =>
	text
		.slice(0, MAX_LOG_MESSAGE_LENGTH * 4)
		.replace(/https?:\/\/[^\s"'<>]+/gi, (url) =>
			url.replace(/(https?:\/\/)[^/@\s]+@/i, '$1[REDACTED]@').replace(/([?#]).*$/, '$1[REDACTED]'),
		)
		.replace(/\b((?:proxy-)?authorization\s*[:=]\s*)(?:Bearer|Basic)\s+[^\s,"']+/gi, '$1[REDACTED]')
		.replace(
			/\b(password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|cookie|signature)["']?\s*[:=]\s*["']?[^\s,;"']+/gi,
			'$1=[REDACTED]',
		)

// Never retain caller objects or execute their getters/toJSON methods.
export const formatLogArgs = (args: unknown[]): string => {
	const seen = new WeakSet<object>()
	let remaining = MAX_LOG_MESSAGE_LENGTH
	const take = (text: string): string => {
		const safe = redactText(text)
		const result = safe.slice(0, Math.max(0, remaining))
		remaining -= result.length
		return result
	}
	let nodes = 0
	const visit = (value: unknown, depth = 0): string => {
		if (remaining <= 0 || ++nodes > 200) return ''
		if (typeof value === 'string') return take(value)
		if (value === null || typeof value !== 'object') return take(String(value))
		if (seen.has(value)) return take('[Circular]')
		if (depth >= 5) return take('[Depth limit]')
		seen.add(value)
		try {
			const entries = Object.getOwnPropertyNames(value).slice(0, 50)
			let result = take(Array.isArray(value) ? '[' : '{')
			for (const key of entries) {
				if (remaining <= 0) break
				const descriptor = Object.getOwnPropertyDescriptor(value, key)
				result += take(`${key}: `)
				result += sensitiveKey.test(key)
					? take('[REDACTED]')
					: descriptor && 'value' in descriptor
						? visit(descriptor.value, depth + 1)
						: take('[Accessor]')
				result += take(', ')
			}
			return result + take(Array.isArray(value) ? ']' : '}')
		} catch {
			return take('[Unserializable]')
		}
	}
	let result = ''
	for (const arg of args) {
		if (remaining <= 0) break
		if (result) result += take(' ')
		result += visit(arg)
	}
	return remaining === 0 ? result.slice(0, -1) + '…' : result
}

export const useLogger = createStore<LoggerState>((set) => ({
	logs: [],
	addLog: (level, ...args) =>
		set((state) => {
			const message = formatLogArgs(args)
			const newLog = {
				timestamp: new Date().toISOString(),
				level,
				message,
				details: args.length > 1 ? message : undefined,
			}

			// 在控制台打印日志
			console.log(`[${newLog.timestamp}] [${level}] ${message}`)

			return {
				logs: [...state.logs, newLog].slice(-MAX_LOG_ENTRIES),
			}
		}),
	clearLogs: () => set({ logs: [] }),
}))

const createLogFunction =
	(level: LogLevel) =>
	(...args: unknown[]) => {
		useLogger.getState().addLog(level, ...args)
	}

export const logInfo = createLogFunction('INFO')
export const logWarn = createLogFunction('WARN')
export const logError = createLogFunction('ERROR')

export const useLoggerHook = () => useStore(useLogger)
