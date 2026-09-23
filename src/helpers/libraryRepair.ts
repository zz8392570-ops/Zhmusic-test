import { fakeAudioMp3Uri } from '@/constants/images'
import { searchSongsAcrossPlatforms } from '@/helpers/crossPlatformSearch'
import { rankReplacementSourcesWithScore } from '@/helpers/playlistOrganizer'
import { resolveSource } from '@/player/MusicSourceResolver'
import type { Track } from '@/player/types'

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
): Promise<LibraryRepairResult> {
	const nextTracks = [...tracks]
	const review: IMusic.IMusicItem[] = []
	const replacements: LibraryRepairResult['replacements'] = []
	let unavailable = 0

	for (let index = 0; index < tracks.length; index++) {
		const track = tracks[index]
		const resolved = await resolveSource(track, { requestType: 'download', totalTimeoutMs: 8_000 })
		if (isPlayable(resolved.url)) continue
		unavailable++
		const query = [track.title, track.artist].filter(Boolean).join(' ')
		const search = await searchSongsAcrossPlatforms(query, 1, 'all')
		const best = rankReplacementSourcesWithScore(track as Track, search.data)[0]
		if (!best || best.score < 14) {
			review.push(track)
			continue
		}
		const replacementResult = await resolveSource(best.track as IMusic.IMusicItem, {
			requestType: 'download',
			totalTimeoutMs: 8_000,
		})
		if (!isPlayable(replacementResult.url)) {
			review.push(track)
			continue
		}
		const replacement = best.track as IMusic.IMusicItem
		nextTracks[index] = replacement
		replacements.push({ original: track, replacement })
	}

	return {
		tracks: nextTracks,
		unavailable,
		repaired: replacements.length,
		review,
		replacements,
	}
}
