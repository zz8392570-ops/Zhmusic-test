import { assert, checks, deferred, flush, loadModule } from './native-services-fixture.mjs'
const { check, finish } = checks()

function fixture() {
	const timers = new Map(),
		attempts = [],
		moves = [],
		deleted = []
	let timerId = 0
	const api = loadModule(
		'src/helpers/fileDownload.ts',
		{
			'expo-file-system': {
				File: class {
					constructor(...parts) {
						this.uri = parts.map((part) => part.uri ?? part).join('/')
					}
					move(target) {
						moves.push(target.uri)
					}
					delete() {
						deleted.push(this.uri)
					}
				},
				Paths: { cache: 'cache', info: () => ({ exists: true }) },
			},
			'expo-file-system/legacy': {
				FileSystemSessionType: { FOREGROUND: 1 },
				createDownloadResumable: (_url, uri, _options, progress) => {
					const job = { ...deferred(), uri, progress, cancellations: 0 }
					attempts.push(job)
					return {
						downloadAsync: () => job.promise,
						cancelAsync: async () => {
							job.cancellations++
						},
					}
				},
			},
			'./logger': { logError() {} },
		},
		{
			setTimeout: (callback, delay) => {
				const id = ++timerId
				timers.set(id, { callback, delay })
				return id
			},
			clearTimeout: (id) => timers.delete(id),
		},
	)
	const expire = () => {
		assert.equal(timers.size, 1)
		const [id, timer] = [...timers][0]
		assert.equal(timer.delay, 30_000)
		timers.delete(id)
		timer.callback()
	}
	return { ...api, timers, attempts, moves, deleted, expire }
}

await check(
	'stalled transfers retry once, clean each attempt and release the final failure',
	async () => {
		const h = fixture()
		const pending = h.downloadFile('https://audio.test', 'target', undefined, 'task')
		const rejected = assert.rejects(pending, /长时间无进度/)
		h.expire()
		await flush()
		assert.equal(h.attempts.length, 2)
		assert.notEqual(h.attempts[0].uri, h.attempts[1].uri)
		h.expire()
		await rejected
		assert.equal(h.attempts.length, 2)
		assert.equal(h.deleted.length, 2)
		assert.equal(h.timers.size, 0)
		assert.deepEqual(h.moves, [])
		assert(h.attempts.every((job) => job.cancellations === 1))
		// Late success from either timed out transport must never commit a file.
		for (const job of h.attempts) job.resolve({ status: 200 })
		await flush()
		assert.deepEqual(h.moves, [])
	},
)
await check('a fresh attempt can recover a stalled transfer and commit exactly once', async () => {
	const h = fixture()
	const pending = h.downloadFile('https://audio.test', 'target', undefined, 'task')
	h.expire()
	await flush()
	h.attempts[1].resolve({ status: 200 })
	await pending
	h.attempts[0].resolve({ status: 200 })
	await flush()
	assert.deepEqual(h.moves, ['target'])
	assert.equal(h.timers.size, 0)
	assert.equal(h.deleted.length, 2)
})
await check('unknown content length resets the idle timer only when bytes advance', async () => {
	const h = fixture()
	const pending = h.downloadFile('https://audio.test', 'target')
	const firstTimer = [...h.timers.keys()][0]
	h.attempts[0].progress({ totalBytesWritten: 10, totalBytesExpectedToWrite: -1 })
	const nextTimer = [...h.timers.keys()][0]
	assert.notEqual(nextTimer, firstTimer)
	h.attempts[0].progress({ totalBytesWritten: 10, totalBytesExpectedToWrite: -1 })
	assert.equal([...h.timers.keys()][0], nextTimer)
	h.attempts[0].resolve({ status: 200 })
	await pending
	assert.deepEqual(h.moves, ['target'])
	assert.equal(h.timers.size, 0)
})
await check(
	'cancellation settles a hung native transfer without retry and the task can restart',
	async () => {
		const h = fixture()
		const pending = h.downloadFile('https://audio.test', 'target', undefined, 'task')
		const rejected = assert.rejects(pending, /取消/)
		await h.cancelDownload('task')
		await rejected
		assert.equal(h.attempts.length, 1)
		assert.equal(h.timers.size, 0)
		assert.deepEqual(h.moves, [])
		h.clearDownloadCancellation('task')
		const restarted = h.downloadFile('https://audio.test', 'target', undefined, 'task')
		h.attempts[1].resolve({ status: 200 })
		await restarted
		assert.deepEqual(h.moves, ['target'])
	},
)
await check('HTTP failures do not retry or overwrite an existing destination', async () => {
	const h = fixture()
	const pending = h.downloadFile('https://audio.test', 'target')
	h.attempts[0].resolve({ status: 403 })
	await assert.rejects(pending, /403/)
	assert.equal(h.attempts.length, 1)
	assert.deepEqual(h.moves, [])
	assert.equal(h.timers.size, 0)
})
finish()
