import { cacheRevisionStore } from '@/player/PlayerStore'
import { resolveLocalFile } from './localFile'
import { File } from 'expo-file-system'
import * as FS from 'expo-file-system/legacy'
import SHA256 from 'crypto-js/sha256'
import { Buffer } from 'buffer'
import type { Track } from '@/player/types'
import { personalTrackKey } from './personalFeatures'
import PersistStatus from '@/store/PersistStatus'
const root = `${FS.documentDirectory}download/music/assets/`
const activeWrites = new Set<string>()
const assetPath = (track: Track, kind: 'lyric' | 'artwork') =>
	`${root}${SHA256(personalTrackKey(track)).toString()}.${kind === 'lyric' ? 'json' : 'image'}`

async function writeAsset(path: string, text: string, base64 = false, signal?: AbortSignal) {
	const temporary = `${path}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
	activeWrites.add(temporary)
	try {
		await FS.writeAsStringAsync(temporary, text, base64 ? { encoding: FS.EncodingType.Base64 } : {})
		if (signal?.aborted) return false
		await new File(temporary).move(new File(path), { overwrite: true })
		return true
	} finally {
		activeWrites.delete(temporary)
		try {
			await FS.deleteAsync(temporary, { idempotent: true })
		} catch {
			/* Optional temporary cleanup. */
		}
	}
}

export function retainOfflineAssets(track: Track) {
	const id = SHA256(personalTrackKey(track)).toString()
	const pins = PersistStatus.get('offline.assetPins') ?? []
	if (!pins.includes(id)) PersistStatus.set('offline.assetPins', [...pins, id])
}
export function releaseOfflineAssets(tracks: readonly Track[]) {
	const ids = new Set(tracks.map((track) => SHA256(personalTrackKey(track)).toString()))
	PersistStatus.set(
		'offline.assetPins',
		(PersistStatus.get('offline.assetPins') ?? []).filter((id) => !ids.has(id)),
	)
	cacheRevisionStore.setValue(cacheRevisionStore.getValue() + 1)
}
const protectedAsset = (name: string) =>
	(PersistStatus.get('offline.assetPins') ?? []).includes(name.split('.')[0])
async function assetFiles() {
	if (!(await FS.getInfoAsync(root)).exists) return []
	const names = (await FS.readDirectoryAsync(root)).filter((name) =>
		/^[a-f0-9]{64}\.(json|image)$/.test(name),
	)
	const result: { name: string; size: number }[] = []
	let next = 0
	await Promise.all(
		Array.from({ length: Math.min(4, names.length) }, async () => {
			while (next < names.length) {
				const name = names[next++]
				const info = await FS.getInfoAsync(root + name)
				if (info.exists && !info.isDirectory) result.push({ name, size: info.size })
			}
		}),
	)
	return result
}
export async function getOfflineAssetUsage() {
	const usage = { lyric: 0, artwork: 0, protected: 0, total: 0 }
	for (const file of await assetFiles()) {
		usage[file.name.endsWith('.json') ? 'lyric' : 'artwork'] += file.size
		usage.total += file.size
		if (protectedAsset(file.name)) usage.protected += file.size
	}
	return usage
}
export async function clearOfflineAssets() {
	let bytes = 0
	try {
		for (const file of await assetFiles()) {
			if (
				protectedAsset(file.name) ||
				[...activeWrites].some((path) => path.startsWith(root + file.name + '.'))
			)
				continue
			await FS.deleteAsync(root + file.name, { idempotent: true })
			bytes += file.size
		}
	} finally {
		cacheRevisionStore.setValue(cacheRevisionStore.getValue() + 1)
	}
	return bytes
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
	const saved = await writeAsset(assetPath(track, 'lyric'), text, false, signal)
	if (saved) cacheRevisionStore.setValue(cacheRevisionStore.getValue() + 1)
	return saved
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
	fetchLyric: (track: IMusic.IMusicItem, signal?: AbortSignal) => Promise<ILyric.ILyricSource>,
) {
	const saved = await readOfflineLyric(track)
	if (saved) return saved
	if (PersistStatus.get('music.offlinePlayback'))
		return { rawLrc: '', translation: '' } as ILyric.ILyricSource
	const canonical = {
		...track,
		id: track.platform === 'local' ? track.id : track.originalId || track.id,
	}
	const controller = new AbortController()
	const unsubscribe = PersistStatus.subscribe((key) => {
		if (key === 'music.offlinePlayback' && PersistStatus.get('music.offlinePlayback'))
			controller.abort()
	})
	try {
		const result = await fetchLyric(canonical, controller.signal)
		if (controller.signal.aborted) return { rawLrc: '', translation: '' } as ILyric.ILyricSource
		try {
			await saveOfflineLyric(track, result, controller.signal)
		} catch {
			/* Storage can be full. */
		}
		return result
	} finally {
		unsubscribe()
	}
}
