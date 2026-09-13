export type AudioQuality =
	| IMusic.IQualityKey
	| 'flac24bit'
	| 'mp3'
	| 'aac'
	| 'm4a'
	| 'ogg'
	| 'wav'
	| 'ape'
	| 'local'
	| 'unknown'

const KNOWN_QUALITIES = new Set<AudioQuality>([
	'128k',
	'320k',
	'flac',
	'flac24bit',
	'mp3',
	'aac',
	'm4a',
	'ogg',
	'wav',
	'ape',
	'local',
	'unknown',
])

export const normalizeAudioQuality = (value: unknown): AudioQuality | null => {
	if (typeof value !== 'string') return null
	const normalized = value.trim().toLowerCase() as AudioQuality
	return KNOWN_QUALITIES.has(normalized) ? normalized : null
}

export const inferAudioQualityFromPath = (path: string | null | undefined): AudioQuality | null => {
	if (!path) return null
	const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(path)?.[1]?.toLowerCase()
	if (!extension) return null
	return normalizeAudioQuality(extension)
}

export const formatAudioQuality = (quality: AudioQuality | string | null | undefined) => {
	switch (normalizeAudioQuality(quality)) {
		case '128k':
			return '128K'
		case '320k':
			return '320K'
		case 'flac':
			return 'FLAC'
		case 'flac24bit':
			return 'Hi-Res FLAC'
		case 'mp3':
			return 'MP3'
		case 'm4a':
			return 'M4A'
		case 'aac':
			return 'AAC'
		case 'ogg':
			return 'OGG'
		case 'wav':
			return 'WAV'
		case 'ape':
			return 'APE'
		case 'local':
			return 'LOCAL'
		default:
			return ''
	}
}
