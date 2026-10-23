import shuffle from 'lodash.shuffle'
import PersistStatus from '@/store/PersistStatus'
import type { Track } from '@/player/types'
import { smartShuffle } from './smartShuffle'
export function shuffleForListening<T extends Track>(tracks: T[]): T[] {
	return PersistStatus.get('music.smartShuffle') === true
		? smartShuffle(
				tracks,
				PersistStatus.get('music.listeningStats') ?? [],
				PersistStatus.get('music.favorites') ?? [],
			)
		: shuffle(tracks)
}
