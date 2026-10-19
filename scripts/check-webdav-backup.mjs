import SHA256 from 'crypto-js/sha256.js'
import { Buffer } from 'node:buffer'
import { DOMParser } from '@xmldom/xmldom'
import { assert, checks, loadModule, deferred, flush } from './native-services-fixture.mjs'

const { check, finish } = checks()
const snapshots = loadModule(
	'src/helpers/webDavSnapshots.ts',
	{ '@xmldom/xmldom': { DOMParser } },
	{ URL },
)
const secureValues = new Map()
const requests = []
let nextResponse
const timers = new Map()
let timerId = 0
const headers = (values = {}) => ({
	get: (name) => values[name.toLowerCase()] ?? null,
})
const response = (status, text = '', headerValues = {}) => ({
	status,
	ok: status >= 200 && status < 300,
	headers: headers(headerValues),
	text: async () => text,
})
const fetch = async (url, options) => {
	requests.push({ url, options })
	return Array.isArray(nextResponse) ? nextResponse.shift() : nextResponse
}
const parseMusicBackup = (text) => {
	if (Buffer.byteLength(text) > 100) throw new Error('Backup exceeds size limit')
	const value = JSON.parse(text)
	if (value.format !== 'zhmusic-backup') throw new Error('Unsupported backup')
	return value
}
const webdav = loadModule(
	'src/helpers/webDavBackup.ts',
	{
		'crypto-js/sha256': SHA256,
		'@/helpers/logger': { logError() {} },
		'@/helpers/musicBackup': { MAX_BACKUP_BYTES: 100, parseMusicBackup },
		buffer: { Buffer },
		'expo/fetch': { fetch },
		'@/helpers/webDavSnapshots': snapshots,
		'expo-secure-store': {
			getItemAsync: async (key) => secureValues.get(key) ?? null,
			setItemAsync: async (key, value) => secureValues.set(key, value),
		},
	},
	{
		fetch,
		URL,
		setTimeout: (callback) => {
			const id = ++timerId
			timers.set(id, callback)
			return id
		},
		clearTimeout: (id) => timers.delete(id),
	},
)

const config = {
	url: 'https://dav.example.test/root/',
	username: '张三',
	password: 'secret',
	remotePath: 'music backups/Cymusic.json',
}
const backup = { format: 'zhmusic-backup', version: 1 }

await check(
	'HTTP credentials cannot be saved or sent; legacy config remains editable',
	async () => {
		const insecure = { ...config, url: 'http://dav.example.test/root' }
		const count = requests.length
		for (const operation of [
			webdav.saveWebDavBackupConfig,
			webdav.testWebDavConnection,
			(value) => webdav.uploadWebDavBackup(value, backup),
			webdav.downloadWebDavBackup,
		]) {
			await assert.rejects(operation(insecure), (error) => error.code === 'https-required')
		}
		assert.equal(requests.length, count)
		secureValues.set('cymusic.webdav.backup', JSON.stringify(insecure))
		assert.equal((await webdav.loadWebDavBackupConfig()).url, insecure.url)
		secureValues.clear()
	},
)

await check('configuration is normalized and credentials stay in secure storage', async () => {
	const saved = await webdav.saveWebDavBackupConfig(config)
	assert.equal(saved.url, 'https://dav.example.test/root')
	assert.equal(saved.remotePath, 'music backups/Cymusic.json')
	const stored = [...secureValues.values()][0]
	assert.match(stored, /secret/)
	const loaded = await webdav.loadWebDavBackupConfig()
	assert.equal(loaded.password, 'secret')
	await assert.rejects(
		webdav.saveWebDavBackupConfig({ ...config, url: 'ftp://dav.example.test' }),
		(error) => error.code === 'invalid-config',
	)
})

await check(
	'connection and upload use WebDAV methods, encoded paths and UTF-8 basic auth',
	async () => {
		nextResponse = [response(201), response(204)]
		await webdav.testWebDavConnection(config)
		const connection = requests.slice(-2)
		assert.equal(connection[0].options.method, 'PUT')
		assert.match(connection[0].url, /\/music%20backups\/ZhMusic-write-test-\d+.tmp$/)
		assert.equal(connection[1].options.method, 'DELETE')
		nextResponse = response(201)
		await webdav.uploadWebDavBackup(config, backup)
		const upload = requests.at(-1)
		assert.equal(upload.options.method, 'PUT')
		assert.equal(upload.options.redirect, 'error')
		assert.equal(upload.url, 'https://dav.example.test/root/music%20backups/Cymusic.json')
		assert.equal(upload.options.headers['Content-Type'], 'application/octet-stream')
		assert.equal(
			upload.options.headers.Authorization,
			`Basic ${Buffer.from('张三:secret').toString('base64')}`,
		)
		assert.equal(JSON.parse(upload.options.body).format, 'zhmusic-backup')
	},
)

await check(
	'missing directories and missing backup files have actionable error codes',
	async () => {
		nextResponse = response(404)
		await assert.rejects(
			webdav.uploadWebDavBackup(config, backup),
			(error) => error.code === 'directory-not-found' && error.status === 404,
		)
		nextResponse = response(404)
		await assert.rejects(
			webdav.downloadWebDavBackup(config),
			(error) => error.code === 'backup-not-found' && error.status === 404,
		)
	},
)

await check('connection test rejects an unwritable backup directory', async () => {
	nextResponse = response(403)
	await assert.rejects(
		webdav.testWebDavConnection(config),
		(error) => error.code === 'unauthorized' && error.status === 403,
	)
})

await check('HTTP 409 creates the parent collection and retries the write', async () => {
	nextResponse = [response(409), response(201), response(201), response(204)]
	await webdav.testWebDavConnection(config)
	const recovery = requests.slice(-4)
	assert.equal(recovery[0].options.method, 'PUT')
	assert.equal(recovery[1].options.method, 'MKCOL')
	assert.equal(recovery[1].url, 'https://dav.example.test/root/music%20backups/')
	assert.equal(recovery[2].options.method, 'PUT')
	assert.equal(recovery[3].options.method, 'DELETE')
})

await check('snapshot upload writes latest and one dated daily file', async () => {
	const now = new Date(2026, 9, 8, 12, 30)
	nextResponse = [response(201), response(201)]
	await webdav.uploadWebDavBackupSnapshots(config, backup, now)
	const snapshots = requests.slice(-2)
	assert.equal(snapshots[0].url, 'https://dav.example.test/root/music%20backups/Cymusic.json')
	assert.equal(
		snapshots[1].url,
		'https://dav.example.test/root/music%20backups/daily/ZhMusic-2026-10-08.json',
	)
	const requestCount = requests.length
	assert.equal(await webdav.runDailyWebDavBackup(backup, now), 'skipped')
	assert.equal(requests.length, requestCount)
	nextResponse = [response(201), response(201)]
	assert.equal(await webdav.runDailyWebDavBackup(backup, new Date(2026, 9, 9, 9, 0)), 'uploaded')
	assert.match(requests.at(-1).url, /\/daily\/ZhMusic-2026-10-09.json$/)
})

await check('download validates status, size and backup format before returning data', async () => {
	nextResponse = response(200, JSON.stringify(backup))
	assert.equal((await webdav.downloadWebDavBackup(config)).format, 'zhmusic-backup')
	nextResponse = response(401)
	await assert.rejects(
		webdav.downloadWebDavBackup(config),
		(error) => error.code === 'unauthorized',
	)
	nextResponse = response(200, JSON.stringify(backup), { 'content-length': '101' })
	await assert.rejects(webdav.downloadWebDavBackup(config), (error) => error.code === 'too-large')
	nextResponse = response(200, JSON.stringify({ wrong: true }))
	await assert.rejects(
		webdav.downloadWebDavBackup(config),
		(error) => error.code === 'invalid-backup',
	)
})

const listing = (rows) => `<d:multistatus xmlns:d="DAV:">${rows}</d:multistatus>`
const entry = (href, status = '200 OK', size = '42', collection = '') =>
	`<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getcontentlength>${size}</d:getcontentlength>${collection}</d:prop><d:status>HTTP/1.1 ${status}</d:status></d:propstat></d:response>`
const directory = 'https://dav.example.test/root/music%20backups/daily/'

await check(
	'DAV listing handles namespaces, encoded paths, failed properties and date sorting',
	async () => {
		nextResponse = response(
			207,
			listing(
				entry('/root/music%20backups/daily/ZhMusic-2026-10-08.json') +
					entry('ZhMusic-2026-10-10.json') +
					entry('ZhMusic-2026-10-10.json') +
					entry('ZhMusic-2026-10-09.json', '404 Not Found') +
					entry(
						'ZhMusic-2026-10-11.json',
						'200 OK',
						'0',
						'<d:resourcetype><d:collection/></d:resourcetype>',
					) +
					entry('https://evil.test/ZhMusic-2026-10-07.json') +
					entry('../ZhMusic-2026-10-06.json') +
					entry('ZhMusic-2026-02-30.json') +
					entry('sub/ZhMusic-2026-10-05.json'),
			),
		)
		const result = await webdav.listWebDavSnapshots(config)
		assert.equal(result.map((item) => item.date).join(','), '2026-10-10,2026-10-08')
		assert.equal(result[0].sizeBytes, 42)
		assert.equal(requests.at(-1).options.method, 'PROPFIND')
		assert.equal(requests.at(-1).options.headers.Depth, '1')
		assert.equal(requests.at(-1).url, directory)
	},
)

await check(
	'snapshot listing rejects malformed XML and treats missing daily directory as empty',
	async () => {
		nextResponse = response(404)
		assert.equal((await webdav.listWebDavSnapshots(config)).length, 0)
		nextResponse = response(207, '<html/>')
		await assert.rejects(
			webdav.listWebDavSnapshots(config),
			(error) => error.code === 'invalid-listing',
		)
		assert.throws(() =>
			snapshots.parseWebDavSnapshots('<!DOCTYPE x><d:multistatus xmlns:d="DAV:"/>', directory),
		)
		assert.throws(() =>
			snapshots.parseWebDavSnapshots('<d:multistatus xmlns:d="DAV:"><bad>', directory),
		)
		const plain = snapshots.parseWebDavSnapshots('<multistatus xmlns="DAV:"/>', directory)
		assert.equal(plain.length, 0)
	},
)

await check(
	'historical download constructs a trusted path and rejects date traversal before requests',
	async () => {
		nextResponse = response(200, JSON.stringify(backup))
		assert.equal((await webdav.downloadWebDavBackup(config, '2026-10-08')).format, 'zhmusic-backup')
		assert.equal(requests.at(-1).url, `${directory}ZhMusic-2026-10-08.json`)
		const count = requests.length
		for (const date of ['../latest', '2026-02-30', '2026-99-99', '2026-10-08?token=x']) {
			await assert.rejects(
				webdav.downloadWebDavBackup(config, date),
				(error) => error.code === 'invalid-config',
			)
		}
		assert.equal(requests.length, count)
		nextResponse = response(200, '{"bad":true}')
		await assert.rejects(
			webdav.downloadWebDavBackup(config, '2026-10-08'),
			(error) => error.code === 'invalid-backup',
		)
	},
)

await check('deadline covers a stalled response body and retires timers', async () => {
	const stalled = deferred()
	nextResponse = { ...response(200), text: () => stalled.promise }
	const pending = webdav.downloadWebDavBackup(config)
	const rejected = assert.rejects(pending, (error) => error.code === 'timeout')
	await flush()
	assert.equal(timers.size, 1)
	for (const callback of timers.values()) callback()
	await rejected
	assert.equal(timers.size, 0)
	assert.equal(requests.at(-1).options.signal.aborted, true)
	stalled.resolve(JSON.stringify(backup))
	await flush()
})

await check('download and listing cancel after headers even if body ignores abort', async () => {
	for (const operation of [
		(signal) => webdav.downloadWebDavBackup(config, undefined, signal),
		(signal) => webdav.listWebDavSnapshots(config, signal),
	]) {
		const controller = new AbortController()
		const stalled = deferred()
		nextResponse = { ...response(200), text: () => stalled.promise }
		const pending = operation(controller.signal)
		const rejected = assert.rejects(pending, (error) => error.code === 'cancelled')
		await flush()
		controller.abort()
		await rejected
		assert.equal(timers.size, 0)
		assert.equal(requests.at(-1).options.signal.aborted, true)
		stalled.resolve('invalid late response')
		await flush()
	}
})

await check('pre-cancelled download sends no request', async () => {
	const controller = new AbortController()
	controller.abort()
	const count = requests.length
	await assert.rejects(
		webdav.downloadWebDavBackup(config, undefined, controller.signal),
		(error) => error.code === 'cancelled',
	)
	assert.equal(requests.length, count)
	assert.equal(timers.size, 0)
})

await check(
	'same-day library changes upload again while timestamp-only changes are skipped',
	async () => {
		await webdav.saveWebDavBackupConfig(config)
		const now = new Date(2026, 9, 19, 12)
		const first = { ...backup, settings: { n: 1 } }
		nextResponse = [response(201), response(201)]
		assert.equal(await webdav.runDailyWebDavBackup(first, now), 'uploaded')
		const count = requests.length
		assert.equal(
			await webdav.runDailyWebDavBackup({ ...first, createdAt: 'later' }, now),
			'skipped',
		)
		assert.equal(requests.length, count)
		nextResponse = [response(201), response(201)]
		assert.equal(
			await webdav.runDailyWebDavBackup({ ...backup, settings: { n: 2 } }, now),
			'uploaded',
		)
		assert.equal(requests.length, count + 2)
	},
)
await check(
	'retention deletes only owned daily snapshots older than the inclusive cutoff',
	async () => {
		const base = requests.length
		nextResponse = [
			response(
				207,
				listing(
					entry(`${directory}ZhMusic-2026-09-19.json`) +
						entry(`${directory}ZhMusic-2026-09-20.json`) +
						entry(`${directory}ZhMusic-2026-10-19.json`) +
						entry(`${directory}other.json`) +
						entry(`${directory}nested/ZhMusic-2020-01-01.json`) +
						entry('https://other.test/ZhMusic-2020-01-01.json'),
				),
			),
			response(204),
		]
		await webdav.pruneWebDavSnapshots({ ...config, retentionDays: 30 }, new Date(2026, 9, 19, 12))
		const sent = requests.slice(base)
		assert.equal(sent.length, 2)
		assert.equal(sent[1].options.method, 'DELETE')
		assert.equal(sent[1].url, `${directory}ZhMusic-2026-09-19.json`)
		const count = requests.length
		await webdav.pruneWebDavSnapshots({ ...config, retentionDays: 0 })
		assert.equal(requests.length, count)
	},
)
await check(
	'concurrent manual and automatic snapshot uploads retain invocation order',
	async () => {
		const wait = deferred()
		const count = requests.length
		nextResponse = [wait.promise, response(201), response(201), response(201)]
		const first = webdav.uploadWebDavBackupSnapshots(config, backup)
		const second = webdav.uploadWebDavBackupSnapshots(config, { ...backup, settings: { n: 2 } })
		await flush()
		assert.equal(requests.length, count + 1)
		wait.resolve(response(201))
		await Promise.all([first, second])
		assert.equal(requests.length, count + 4)
		assert.equal(JSON.parse(requests[count + 2].options.body).settings.n, 2)
	},
)
finish()
