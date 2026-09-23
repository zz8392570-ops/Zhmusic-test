import PersistStatus from '@/store/PersistStatus'
import type { AudioQuality } from '@/helpers/audioQuality'

export type SourceErrorCategory =
	| 'timeout'
	| 'invalid-url'
	| 'network'
	| 'unsupported-format'
	| 'playback'
	| 'cancelled'
	| 'unknown'

export type SourceDiagnosticEvent = {
	id: string
	timestamp: number
	requestKey: string
	requestType: 'current' | 'preload' | 'download'
	track: { id: string; title: string; artist: string; platform?: string }
	sourceId?: string
	sourceName?: string
	requestedQuality?: IMusic.IQualityKey
	actualQuality?: AudioQuality
	step: string
	durationMs?: number
	result: 'success' | 'failure' | 'cancelled'
	category?: SourceErrorCategory
	message?: string
}

const MAX_DIAGNOSTIC_EVENTS = 120

export const classifySourceError = (error: unknown): SourceErrorCategory => {
	const name = error instanceof Error ? error.name : ''
	const message = error instanceof Error ? error.message : String(error ?? '')
	if (name === 'AbortError' || /cancel|取消|aborted/i.test(message)) return 'cancelled'
	if (name === 'TimeoutError' || /timeout|timed out|超时/i.test(message)) return 'timeout'
	if (/unsupported|decode|codec|format|解码|格式/i.test(message)) return 'unsupported-format'
	if (/network|offline|internet|socket|dns|网络/i.test(message)) return 'network'
	if (/url|link|http\s*[34-5]\d\d|链接/i.test(message)) return 'invalid-url'
	if (/playback|player|renderer|audio|播放/i.test(message)) return 'playback'
	return 'unknown'
}

export const getSourceErrorMessage = (category: SourceErrorCategory) => {
	switch (category) {
		case 'timeout':
			return '获取音源超时，请换源或重试。'
		case 'invalid-url':
			return '播放链接已失效，请换源或重试。'
		case 'network':
			return '网络连接异常，请检查网络后重试。'
		case 'unsupported-format':
			return '当前音频格式暂不支持，请尝试其他音源。'
		case 'playback':
			return '音频加载失败，请换源或重试。'
		case 'cancelled':
			return '已取消获取音源。'
		default:
			return '获取音源失败，请换源或重试。'
	}
}

export const appendSourceDiagnostic = (event: Omit<SourceDiagnosticEvent, 'id' | 'timestamp'>) => {
	const current = PersistStatus.get('music.sourceDiagnostics') ?? []
	const next: SourceDiagnosticEvent[] = [
		...current,
		{
			...event,
			id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
			timestamp: Date.now(),
		},
	].slice(-MAX_DIAGNOSTIC_EVENTS)
	PersistStatus.set('music.sourceDiagnostics', next)
}

export const getSourceDiagnostics = () => PersistStatus.get('music.sourceDiagnostics') ?? []

export const formatSourceDiagnostics = () =>
	getSourceDiagnostics()
		.map((item) =>
			[
				new Date(item.timestamp).toISOString(),
				item.result.toUpperCase(),
				item.category ?? '-',
				`${item.track.title} - ${item.track.artist}`,
				item.sourceName ?? '-',
				`${item.requestedQuality ?? '-'} -> ${item.actualQuality ?? '-'}`,
				`${item.durationMs ?? '-'}ms`,
				item.step,
				item.message ?? '',
			].join(' | '),
		)
		.join('\n')
