import PersistStatus from '@/store/PersistStatus'
import { normalizeFavoriteGroups } from './favoriteGroups'

/** One upgrade pass only: later explicit undo/splits must survive restarts. */
export function initializeFavorites(): IMusic.IMusicItem[] {
	const current = PersistStatus.get('music.favorites') ?? []
	try {
		if ((PersistStatus.get('music.favoriteGroupingVersion') ?? 0) >= 1) return current
		const grouped = normalizeFavoriteGroups(current) as IMusic.IMusicItem[]
		// PersistStatus keeps the pre-change collection in library history atomically.
		if (grouped.length < current.length) PersistStatus.set('music.favorites', grouped)
		PersistStatus.set('music.favoriteGroupingVersion', 1)
		return grouped.length < current.length ? grouped : current
	} catch {
		// A failed upgrade may be retried next launch; always expose the durable collection.
		return PersistStatus.get('music.favorites') ?? current
	}
}
