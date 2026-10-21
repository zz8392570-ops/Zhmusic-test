import { musicApiStore, musicApiSelectedStore } from '@/player/PlayerStore'
import { setMusicApiAsSelectedById, testMusicApiById } from './musicApiControl'

export const isSourceUsable = (api?: IMusic.MusicApi | null) =>
	api?.health?.status === 'normal' || api?.health?.status === 'partial'

/** Test before choosing; a closed setup page must not select a late result. */
export async function testAndSelectSource(id: string, signal: AbortSignal) {
	if (signal.aborted) return false
	await testMusicApiById(id)
	if (signal.aborted) return false
	const sources: IMusic.MusicApi[] = musicApiStore.getValue() ?? []
	const candidate = sources.find((api) => api.id === id)
	if (!isSourceUsable(candidate)) return false
	const selected = await setMusicApiAsSelectedById(id, { silent: true, notify: false, signal })
	return !signal.aborted && selected?.id === id && musicApiSelectedStore.getValue()?.id === id
}
