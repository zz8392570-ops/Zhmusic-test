import { fakeAudioMp3Uri } from '@/constants/images'
import { searchSongsAcrossPlatforms } from '@/helpers/crossPlatformSearch'
import { rankReplacementSourcesWithScore } from '@/helpers/playlistOrganizer'
import { resolveSource } from '@/player/MusicSourceResolver'
import type { Track } from '@/player/types'
import { getFavoriteVariants, isSameFavoriteRecording, mergeFavoriteGroup } from './favoriteGroups'
import { waitForRequest, throwIfRequestAborted } from './requestControl'

export type LibraryRepairResult = {
	tracks: IMusic.IMusicItem[]
	unavailable: number
	repaired: number
	review: IMusic.IMusicItem[]
	replacements: Array<{ original: IMusic.IMusicItem; replacement: IMusic.IMusicItem }>
}

const isPlayable = (url: string) => url !== fakeAudioMp3Uri && !url.includes('fake')

export async function repairUnavailableTracks(
	tracks: IMusic.IMusicItem[],
	options: { signal?: AbortSignal; onProgress?: (checked: number, total: number) => void } = {},
): Promise<LibraryRepairResult> {
	const nextTracks = [...tracks]
	const review: IMusic.IMusicItem[] = []
	const replacements: LibraryRepairResult['replacements'] = []
	let unavailable = 0

	for (let index = 0; index < tracks.length; index++) {
		throwIfRequestAborted(options.signal)
		const track = tracks[index]
		const probe = async (item: IMusic.IMusicItem) => {
			try {
				const resolved = await resolveSource(item, {
					requestType: 'download',
					totalTimeoutMs: 8_000,
					signal: options.signal,
				})
				throwIfRequestAborted(options.signal)
				return isPlayable(resolved.url)
			} catch {
				throwIfRequestAborted(options.signal)
				return false
			}
		}
		if (await probe(track)) {
			options.onProgress?.(index + 1, tracks.length)
			continue
		}
		unavailable++
		let candidates = getFavoriteVariants(track).slice(1)
		try {
			const query = [track.title, track.artist].filter(Boolean).join(' ')
			const search = await waitForRequest(
				() => searchSongsAcrossPlatforms(query, 1, 'all'),
				15_000,
				options.signal,
			)
			candidates = [
				...candidates,
				...rankReplacementSourcesWithScore(track as Track, search.data)
					.filter((item) => item.score >= 14)
					.map((item) => item.track),
			]
		} catch {
			throwIfRequestAborted(options.signal)
		}
		const seen = new Set<string>()
		let replacement: IMusic.IMusicItem | undefined
		for (const candidate of candidates.filter((item) => isSameFavoriteRecording(track, item))) {
			const key = JSON.stringify([candidate.platform, candidate.id])
			if (seen.has(key) || (candidate.platform === track.platform && candidate.id === track.id))
				continue
			seen.add(key)
			if (await probe(candidate as IMusic.IMusicItem)) {
				replacement = mergeFavoriteGroup([candidate, track]) as IMusic.IMusicItem
				break
			}
			if (seen.size >= 3) break
		}
		if (replacement) {
			nextTracks[index] = replacement
			replacements.push({ original: track, replacement })
		} else review.push(track)
		options.onProgress?.(index + 1, tracks.length)
	}

	return {
		tracks: nextTracks,
		unavailable,
		repaired: replacements.length,
		review,
		replacements,
	}
}
