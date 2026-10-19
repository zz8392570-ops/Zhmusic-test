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
				createDownloadResumable: (_url, uri, _options, progress, resumeData) => {
					const job = { ...deferred(), uri, progress, resumeData, cancellations: 0 }
					attempts.push(job)
					return {
						downloadAsync: () => job.promise,
						resumeAsync: () => {
							job.resumed = true
							return job.promise
						},
						pauseAsync: async () => {
							job.resolve(undefined)
							return { url: _url, fileUri: uri, resumeData: 'native-resume' }
						},
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
	const states = new Map()
	api.configureDownloadResume(
		(id) => states.get(id),
		(id, state) => (state ? states.set(id, state) : states.delete(id)),
	)
	return { ...api, timers, attempts, moves, deleted, expire, states }
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
await check(
	'pause preserves native resume state and continues into the same isolated file',
	async () => {
		const h = fixture()
		const initial = h.downloadFile('https://audio.test', 'target', undefined, 'task')
		const rejected = assert.rejects(initial)
		await h.pauseDownload('task')
		await rejected
		assert.equal(h.states.get('task').resumeData, 'native-resume')
		assert.equal(h.deleted.length, 0)
		assert.equal(h.timers.size, 0)
		const resumed = h.downloadFile('https://audio.test', 'target', undefined, 'task')
		assert.equal(h.attempts[1].uri, h.attempts[0].uri)
		assert.equal(h.attempts[1].resumeData, 'native-resume')
		assert.equal(h.attempts[1].resumed, true)
		h.attempts[1].resolve({ status: 206 })
		await resumed
		assert.deepEqual(h.moves, ['target'])
		assert.equal(h.states.size, 0)
	},
)
await check('changed source URL discards partial bytes and performs a fresh download', async () => {
	const h = fixture()
	const pending = h.downloadFile('https://old.test', 'target', undefined, 'task')
	const rejected = assert.rejects(pending)
	await h.pauseDownload('task')
	await rejected
	const next = h.downloadFile('https://new.test', 'target', undefined, 'task')
	assert.equal(h.attempts[1].resumeData, undefined)
	assert.notEqual(h.attempts[1].uri, h.attempts[0].uri)
	h.attempts[1].resolve({ status: 200 })
	await next
	assert.equal(h.states.size, 0)
})
await check(
	'invalid native resume falls back once without committing the failed partial',
	async () => {
		const h = fixture()
		const initial = h.downloadFile('https://audio.test', 'target', undefined, 'task')
		const rejected = assert.rejects(initial)
		await h.pauseDownload('task')
		await rejected
		const next = h.downloadFile('https://audio.test', 'target', undefined, 'task')
		h.attempts[1].reject(new Error('expired resume'))
		await flush()
		assert.equal(h.attempts.length, 3)
		assert.equal(h.attempts[2].resumeData, undefined)
		h.attempts[2].resolve({ status: 200 })
		await next
		assert.deepEqual(h.moves, ['target'])
	},
)
await check('cancelling a paused download retires its partial and resume metadata', async () => {
	const h = fixture()
	const initial = h.downloadFile('https://audio.test', 'target', undefined, 'task')
	const rejected = assert.rejects(initial)
	await h.pauseDownload('task')
	await rejected
	await h.cancelDownload('task')
	assert.equal(h.states.size, 0)
	assert.equal(h.deleted.length, 1)
})
await check(
	'saved resume metadata survives a fresh module instance without trusting arbitrary paths',
	async () => {
		const h = fixture()
		const initial = h.downloadFile('https://audio.test', 'target', undefined, 'task')
		const rejected = assert.rejects(initial)
		await h.pauseDownload('task')
		await rejected
		const restored = fixture()
		restored.states.set('task', h.states.get('task'))
		const next = restored.downloadFile('https://audio.test', 'target', undefined, 'task')
		assert.equal(restored.attempts[0].resumed, true)
		restored.attempts[0].resolve({ status: 206 })
		await next
		restored.states.set('unsafe', {
			url: 'https://audio.test',
			fileUri: 'file:///Documents/important.mp3',
			resumeData: 'blob',
			savedAt: Date.now(),
		})
		const deleted = restored.deleted.length
		restored.discardDownloadResume('unsafe')
		assert.equal(restored.states.has('unsafe'), false)
		assert.equal(restored.deleted.length, deleted)
	},
)
finish()
