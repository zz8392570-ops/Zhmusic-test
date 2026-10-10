import { unknownTrackImageUri } from '@/constants/images'
import { getFullArtwork } from '@/utils/imageUtils'

export const normalizeArtworkUrl = (url: unknown) =>
	getFullArtwork(String(url || '').trim()
		.replace(/^http:\/\/img1\.kwcdn\.kuwo\.cn\//, 'https://img1.kuwo.cn/')
		.replace(/^http:/, 'https:').replace('{size}', '800')) ?? ''

const cache = new Map<string, { url: string | null; expiresAt: number }>()
const requests = new Map<string, Promise<string | undefined>>()

export const resolveLeaderboardArtwork = async (
	platform: unknown, trackId: unknown, artwork?: string,
): Promise<string | undefined> => {
	if (artwork && artwork !== unknownTrackImageUri) return normalizeArtworkUrl(artwork)
	if (platform !== 'kw' || !trackId) return undefined
	const key = `kw:${trackId}`
	const cached = cache.get(key)
	if (cached && cached.expiresAt > Date.now()) return cached.url ?? undefined
	cache.delete(key)
	const pending = requests.get(key)
	if (pending) return pending
	const request = (async () => {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 8_000)
		try {
			const response = await fetch(
				`https://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=url&size=500&rid=${encodeURIComponent(String(trackId))}`,
				{ signal: controller.signal },
			)
			if (!response.ok) return undefined
			const url = normalizeArtworkUrl(await response.text())
			return /^https?:\/\//.test(url) ? url : undefined
		} catch {
			return undefined
		} finally {
			clearTimeout(timeout)
		}
	})().then((url) => {
		if (cache.size >= 200) cache.delete(cache.keys().next().value!)
		cache.set(key, { url: url ?? null, expiresAt: Date.now() + (url ? 24 * 60 * 60_000 : 30_000) })
		requests.delete(key)
		return url
	})
	requests.set(key, request)
	return request
}
