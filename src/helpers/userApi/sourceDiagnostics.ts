import i18n from '@/utils/i18n'
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

export const getSourceErrorMessage = (category: SourceErrorCategory) =>
	i18n.t(`sourceErrors.${category}`)

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
				`${item.track.title} - ${item.track.artist} [${item.track.platform ?? '-'}]`,
				item.sourceName ?? '-',
				`${item.requestedQuality ?? '-'} -> ${item.actualQuality ?? '-'}`,
				`${item.durationMs ?? '-'}ms`,
				item.step,
				item.requestKey,
				item.message ?? '',
			].join(' | '),
		)
		.join('\n')
