import type { MusicPlatform } from '@/helpers/crossPlatformSearch'
import type { PublicPlaylist, PublicPlaylistPage } from '@/helpers/publicPlaylists'

type Operation = 'refresh' | 'more' | 'batch'
export type PublicPlaylistDiscoveryState = {
	key: string
	list: PublicPlaylist[]
	page: number
	hasMore: boolean
	loading: boolean
	loadingMore: boolean
	error: Operation | null
}
export const publicPlaylistQueryKey = (source: MusicPlatform, category: string) =>
	JSON.stringify([source, category])

const emptyState = (key = ''): PublicPlaylistDiscoveryState => ({
	key,
	list: [],
	page: 1,
	hasMore: false,
	loading: true,
	loadingMore: false,
	error: null,
})

/** Owns one visible platform/category and retires requests whenever that query changes. */
export const createPublicPlaylistDiscovery = (
	fetchPage: (source: MusicPlatform, category: string, page: number) => Promise<PublicPlaylistPage>,
) => {
	let state = emptyState()
	let query: { source: MusicPlatform; category: string } | null = null
	let generation = 0
	const listeners = new Set<() => void>()
	const update = (next: Partial<PublicPlaylistDiscoveryState>) => {
		state = { ...state, ...next }
		listeners.forEach((listener) => listener())
	}
	const request = async (operation: Operation) => {
		if (!query || (operation !== 'refresh' && (state.loading || state.loadingMore))) return
		if (operation === 'more' && (!state.hasMore || state.error)) return
		const currentQuery = query
		const requestId = ++generation
		const nextPage =
			operation === 'refresh' ? 1 : operation === 'batch' && !state.hasMore ? 1 : state.page + 1
		update({ loading: operation !== 'more', loadingMore: operation === 'more', error: null })
		try {
			const result = await fetchPage(currentQuery.source, currentQuery.category, nextPage)
			if (requestId !== generation) return
			if (operation !== 'more' && !result.list.length) throw new Error('Empty playlist page')
			let list = result.list
			if (operation === 'more') {
				const existing = new Set(state.list.map((item) => item.id))
				list = [...state.list, ...result.list.filter((item) => !existing.has(item.id))]
			}
			update({ list, page: nextPage, hasMore: result.hasMore && result.list.length > 0 })
		} catch {
			if (requestId === generation) update({ error: operation })
		} finally {
			if (requestId === generation) update({ loading: false, loadingMore: false })
		}
	}
	return {
		getSnapshot: () => state,
		subscribe: (listener: () => void) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		setQuery: (source: MusicPlatform, category: string) => {
			const key = publicPlaylistQueryKey(source, category)
			if (key === state.key) return
			generation += 1
			query = { source, category }
			state = emptyState(key)
			listeners.forEach((listener) => listener())
		},
		refresh: () => request('refresh'),
		loadMore: () => request('more'),
		changeBatch: () => request('batch'),
		retry: () => {
			const operation = state.error
			if (!operation || state.loading || state.loadingMore) return Promise.resolve()
			update({ error: null })
			return request(operation)
		},
		cancel: () => {
			generation += 1
		},
	}
}
