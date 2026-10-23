import { cacheRevisionStore } from '@/player/PlayerStore'
import { resolveLocalFile } from './localFile'
import { File } from 'expo-file-system'
import * as FS from 'expo-file-system/legacy'
import SHA256 from 'crypto-js/sha256'
import { Buffer } from 'buffer'
import type { Track } from '@/player/types'
import { personalTrackKey } from './personalFeatures'
const root = `${FS.documentDirectory}download/music/assets/`
const assetPath = (track: Track, kind: 'lyric' | 'artwork') =>
	`${root}${SHA256(personalTrackKey(track)).toString()}.${kind === 'lyric' ? 'json' : 'image'}`

async function writeAsset(path: string, text: string, base64 = false, signal?: AbortSignal) {
	const temporary = `${path}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
	try {
		await FS.writeAsStringAsync(temporary, text, base64 ? { encoding: FS.EncodingType.Base64 } : {})
		if (signal?.aborted) return false
		await new File(temporary).move(new File(path), { overwrite: true })
		return true
	} finally {
		try {
			await FS.deleteAsync(temporary, { idempotent: true })
		} catch {
			/* Optional temporary cleanup. */
		}
	}
}

export const hasOfflineAsset = async (track: Track, kind: 'lyric' | 'artwork') => {
	try {
		const info = await FS.getInfoAsync(assetPath(track, kind))
		return info.exists && !info.isDirectory && info.size > 0
	} catch {
		return false
	}
}
export const isUsefulLyric = (value: unknown): value is ILyric.ILyricSource =>
	!!value &&
	typeof (value as ILyric.ILyricSource).rawLrc === 'string' &&
	(value as ILyric.ILyricSource).rawLrc.trim().length > 0 &&
	!/^\[00:00(?:\.00)?\](暂无歌词|纯音乐，请欣赏)\s*$/.test(
		(value as ILyric.ILyricSource).rawLrc.trim(),
	)
export async function readOfflineLyric(track: Track): Promise<ILyric.ILyricSource | null> {
	try {
		if (!(await hasOfflineAsset(track, 'lyric'))) return null
		const value = JSON.parse(await FS.readAsStringAsync(assetPath(track, 'lyric')))
		return isUsefulLyric(value) ? value : null
	} catch {
		return null
	}
}
export async function saveOfflineLyric(
	track: Track,
	value: ILyric.ILyricSource,
	signal?: AbortSignal,
) {
	if (!isUsefulLyric(value) || signal?.aborted) return false
	const text = JSON.stringify(value)
	if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) return false
	await FS.makeDirectoryAsync(root, { intermediates: true })
	if (signal?.aborted) return false
	return writeAsset(assetPath(track, 'lyric'), text, false, signal)
}
export async function readOfflineArtwork(track: Track): Promise<string | null> {
	if (await hasOfflineAsset(track, 'artwork')) return assetPath(track, 'artwork')
	const local = await resolveLocalFile(track.artwork)
	return local.status === 'resolved' ? local.fileUri : null
}
export async function saveOfflineArtwork(track: Track, url: string, signal?: AbortSignal) {
	if (!/^https?:\/\//i.test(url) || signal?.aborted) return false
	const controller = new AbortController(),
		abort = () => controller.abort()
	signal?.addEventListener('abort', abort)
	const timer = setTimeout(abort, 10_000)
	try {
		const response = await fetch(url, { signal: controller.signal })
		if (
			!response.ok ||
			!response.headers.get('content-type')?.toLowerCase().startsWith('image/') ||
			Number(response.headers.get('content-length')) > 5 * 1024 * 1024
		)
			return false
		const bytes = await response.arrayBuffer()
		if (controller.signal.aborted || !bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024)
			return false
		await FS.makeDirectoryAsync(root, { intermediates: true })
		if (controller.signal.aborted) return false
		const saved = await writeAsset(
			assetPath(track, 'artwork'),
			Buffer.from(bytes).toString('base64'),
			true,
			controller.signal,
		)
		if (saved) cacheRevisionStore.setValue(cacheRevisionStore.getValue() + 1)
		return saved
	} finally {
		clearTimeout(timer)
		signal?.removeEventListener('abort', abort)
	}
}
export async function getPreparedLyric(
	track: IMusic.IMusicItem,
	fetchLyric: (track: IMusic.IMusicItem) => Promise<ILyric.ILyricSource>,
) {
	const saved = await readOfflineLyric(track)
	if (saved) return saved
	const canonical = {
		...track,
		id: track.platform === 'local' ? track.id : track.originalId || track.id,
	}
	const result = await fetchLyric(canonical)
	// A metadata cache failure must never hide successfully fetched lyrics.
	try {
		await saveOfflineLyric(track, result)
	} catch {
		/* Storage can be full. */
	}
	return result
}
