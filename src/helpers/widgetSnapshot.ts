import type { ListeningScene } from './personalFeatures'
import type { Track } from '@/player/types'
const text = (value: unknown, limit = 200) =>
	typeof value === 'string' ? value.slice(0, limit) : ''
export function buildWidgetSnapshot(
	track: Track | null,
	playlists: readonly { id: string; name?: string; songs?: unknown[] }[],
	favorites: number,
	scenes: readonly ListeningScene[],
	selected: string,
	language: string,
) {
	const collections = [
		{ id: 'favorites', name: language.startsWith('zh') ? '我喜欢' : 'Favorites', count: favorites },
		...playlists
			.filter((item) => item.id.length > 0 && item.id.length <= 1024)
			.sort((a, b) => Number(b.id === selected) - Number(a.id === selected))
			.slice(0, 100)
			.map((item) => ({ id: item.id, name: text(item.name), count: item.songs?.length ?? 0 })),
	]
	return {
		version: 1,
		language: text(language, 16),
		title: text(track?.title),
		artist: text(track?.artist),
		collections,
		scenes: scenes.slice(0, 20).map((item) => ({ id: item.id, name: text(item.name, 40) })),
		selected: collections.some((item) => item.id === selected) ? selected : 'favorites',
	}
}
