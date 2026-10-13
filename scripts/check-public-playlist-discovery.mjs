import { assert, checks, deferred, loadModule } from './native-services-fixture.mjs'

const { createPublicPlaylistDiscovery } = loadModule('src/helpers/publicPlaylistDiscovery.ts', {})
const page = (ids, number = 1, hasMore = true) => ({
	list: ids.map((id) => ({ id, source: 'tx', name: id })),
	page: number,
	hasMore,
})
const harness = () => {
	const requests = []
	const controller = createPublicPlaylistDiscovery((source, category, number) => {
		const result = deferred()
		requests.push({ source, category, number, result })
		return result.promise
	})
	controller.setQuery('tx', '')
	return { controller, requests }
}
const initial = async (h) => {
	const work = h.controller.refresh()
	h.requests.at(-1).result.resolve(page(['one', 'two']))
	await work
}
const suite = checks()
await suite.check(
	'refresh failure preserves the current list, and retry replaces it on success',
	async () => {
		const h = harness()
		await initial(h)
		const work = h.controller.refresh()
		h.requests.at(-1).result.reject(new Error('offline'))
		await work
		assert.equal(
			h.controller
				.getSnapshot()
				.list.map((item) => item.id)
				.join(','),
			'one,two',
		)
		assert.equal(h.controller.getSnapshot().error, 'refresh')
		const retry = h.controller.retry()
		assert.equal(h.requests.at(-1).number, 1)
		h.requests.at(-1).result.resolve(page(['fresh']))
		await retry
		assert.equal(h.controller.getSnapshot().list[0].id, 'fresh')
		assert.equal(h.controller.getSnapshot().error, null)
	},
)
await suite.check(
	'pagination failure stays on the same page and retries exactly once',
	async () => {
		const h = harness()
		await initial(h)
		const more = h.controller.loadMore()
		await h.controller.loadMore()
		assert.equal(h.requests.length, 2)
		h.requests.at(-1).result.reject(new Error('offline'))
		await more
		assert.equal(h.controller.getSnapshot().page, 1)
		await h.controller.loadMore()
		assert.equal(h.requests.length, 2)
		const retry = h.controller.retry()
		assert.equal(h.requests.at(-1).number, 2)
		h.requests.at(-1).result.resolve(page(['two', 'three'], 2, false))
		await retry
		assert.equal(
			h.controller
				.getSnapshot()
				.list.map((item) => item.id)
				.join(','),
			'one,two,three',
		)
		assert.equal(h.controller.getSnapshot().hasMore, false)
	},
)
await suite.check(
	'batch failure keeps the current batch and retry replaces rather than appends',
	async () => {
		const h = harness()
		await initial(h)
		const work = h.controller.changeBatch()
		h.requests.at(-1).result.reject(new Error('offline'))
		await work
		assert.equal(h.controller.getSnapshot().list.length, 2)
		assert.equal(h.controller.getSnapshot().error, 'batch')
		const retry = h.controller.retry()
		h.requests.at(-1).result.resolve(page(['next batch'], 2))
		await retry
		assert.equal(
			h.controller
				.getSnapshot()
				.list.map((item) => item.id)
				.join(','),
			'next batch',
		)
	},
)
await suite.check(
	'switching platform or category clears content and ignores older replies',
	async () => {
		const h = harness()
		await initial(h)
		const old = h.controller.loadMore()
		h.controller.setQuery('wy', '流行')
		assert.equal(h.controller.getSnapshot().list.length, 0)
		const current = h.controller.refresh()
		h.requests.at(-1).result.resolve(page(['网易云']))
		await current
		h.requests[1].result.resolve(page(['wrong platform'], 2))
		await old
		assert.equal(h.controller.getSnapshot().list[0].id, '网易云')
		h.controller.setQuery('wy', '电子')
		assert.equal(h.controller.getSnapshot().list.length, 0)
	},
)
await suite.check(
	'refresh supersedes pending pagination and clears its spinner even on failure',
	async () => {
		const h = harness()
		await initial(h)
		const more = h.controller.loadMore()
		const refresh = h.controller.refresh()
		h.requests.at(-1).result.reject(new Error('offline'))
		await refresh
		h.requests[1].result.resolve(page(['old more'], 2))
		await more
		const state = h.controller.getSnapshot()
		assert.equal(state.loadingMore, false)
		assert.equal(state.loading, false)
		assert.equal(state.error, 'refresh')
		assert.equal(state.list.map((item) => item.id).join(','), 'one,two')
	},
)
await suite.check('empty first page is retryable and empty continuation ends loading', async () => {
	const h = harness()
	const first = h.controller.refresh()
	h.requests.at(-1).result.resolve(page([]))
	await first
	assert.equal(h.controller.getSnapshot().error, 'refresh')
	await initial(h)
	const more = h.controller.loadMore()
	h.requests.at(-1).result.resolve(page([], 2, true))
	await more
	assert.equal(h.controller.getSnapshot().hasMore, false)
	assert.equal(h.controller.getSnapshot().list.length, 2)
})
suite.finish()
