import { Buffer } from 'buffer'

export const DEFAULT_DOWNLOAD_TEMPLATE = '{title} - {artist}'
const TOKENS = ['title', 'artist', 'album', 'quality', 'platform', 'id']

export const isValidDownloadTemplate = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.trim().length > 0 &&
	value.length <= 160 &&
	!Array.from(value).some((char) => char.charCodeAt(0) < 32) &&
	!/[/\\]/.test(value) &&
	!value
		.replace(/\{(\w+)\}/g, (_, token: string) => (TOKENS.includes(token) ? '' : '{invalid}'))
		.match(/[{}]/) &&
	/\{(title|artist|id)\}/.test(value)

export const formatDownloadFilename = (
	track: Pick<IMusic.IMusicItem, 'title' | 'artist' | 'id' | 'platform' | 'album'>,
	quality: string,
	template = DEFAULT_DOWNLOAD_TEMPLATE,
) => {
	const fields: Record<string, string> = {
		title: track.title ?? '',
		artist: track.artist ?? '',
		album: track.album ?? '',
		id: track.id ?? '',
		platform: track.platform ?? 'unknown',
		quality,
	}
	const rule = isValidDownloadTemplate(template) ? template.trim() : DEFAULT_DOWNLOAD_TEMPLATE
	let stem =
		rule
			.replace(/\{(\w+)\}/g, (_, token: string) => fields[token])
			.split('')
			.map((char) => (char.charCodeAt(0) < 32 ? '-' : char))
			.join('')
			.replace(/[/\\?%*:|"<>]/g, '-')
			.replace(/\s+/g, ' ')
			.trim()
			.replace(/\.(mp3|flac|wav|ape|m4a)$/i, '')
			.replace(/^[. ]+|[. ]+$/g, '') || 'audio'
	while (Buffer.byteLength(stem, 'utf8') > 180) stem = Array.from(stem).slice(0, -1).join('')
	if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `_${stem}`
	return `${stem}.${quality === 'flac' || quality === 'flac24bit' ? 'flac' : 'mp3'}`
}
