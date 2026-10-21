import type { Track } from '@/player/types'

const text = (value: unknown) =>
	typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
const digits = (value: unknown) => (/^[1-9]\d*$/.test(text(value)) ? text(value) : null)
const mid = (value: unknown) => (/^[a-zA-Z0-9]{14}$/.test(text(value)) ? text(value) : null)

/** Build provider detail pages only; playback URLs may expire or contain private tokens. */
export function getSongPageUrl(track: Track): string | undefined {
	const id = track.originalId || track.id
	switch (track.platform) {
		case 'tx': {
			const songmid = mid(track.songmid) || mid(id)
			if (songmid) return `https://y.qq.com/n/ryqq/songDetail/${songmid}`
			const songid = digits(track.songId) || digits(id)
			return songid ? `https://i.y.qq.com/v8/playsong.html?songid=${songid}` : undefined
		}
		case 'wy':
			return digits(id) ? `https://music.163.com/#/song?id=${digits(id)}` : undefined
		case 'kw':
			return digits(id) ? `https://www.kuwo.cn/play_detail/${digits(id)}` : undefined
		case 'kg': {
			const hash = [track.hash, id].map(text).find((value) => /^[a-fA-F0-9]{32}$/.test(value))
			return hash ? `https://www.kugou.com/song/#hash=${hash}` : undefined
		}
		case 'mg': {
			const copyrightId = text(track.copyrightId)
			return /^[a-zA-Z0-9]{6,40}$/.test(copyrightId)
				? `https://music.migu.cn/v3/music/song/${copyrightId}`
				: undefined
		}
	}
}

export const isLocalSongUrl = (url: unknown) =>
	typeof url === 'string' && (url.startsWith('/') || /^file:/i.test(url))
