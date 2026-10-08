import { Buffer } from 'node:buffer'
import { assert, checks, loadModule } from './native-services-fixture.mjs'

const { check, finish } = checks()
const secureValues = new Map()
const requests = []
let nextResponse
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
		'@/helpers/musicBackup': { MAX_BACKUP_BYTES: 100, parseMusicBackup },
		buffer: { Buffer },
		'expo-secure-store': {
			getItemAsync: async (key) => secureValues.get(key) ?? null,
			setItemAsync: async (key, value) => secureValues.set(key, value),
		},
	},
	{ fetch, URL },
)

const config = {
	url: 'https://dav.example.test/root/',
	username: '张三',
	password: 'secret',
	remotePath: 'music backups/Cymusic.json',
}
const backup = { format: 'zhmusic-backup', version: 1 }

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
		nextResponse = [response(207), response(201), response(204)]
		await webdav.testWebDavConnection(config)
		const connection = requests.slice(-3)
		assert.equal(connection[0].options.method, 'PROPFIND')
		assert.equal(connection[0].options.headers.Depth, '0')
		assert.equal(connection[0].url, 'https://dav.example.test/root/music%20backups/')
		assert.equal(connection[1].options.method, 'PUT')
		assert.match(connection[1].url, /\/music%20backups\/ZhMusic-write-test-\d+.tmp$/)
		assert.equal(connection[2].options.method, 'DELETE')
		nextResponse = [response(207), response(201)]
		await webdav.uploadWebDavBackup(config, backup)
		const uploadRequests = requests.slice(-2)
		assert.equal(uploadRequests[0].options.method, 'PROPFIND')
		assert.equal(uploadRequests[0].url, 'https://dav.example.test/root/music%20backups/')
		const upload = uploadRequests[1]
		assert.equal(upload.options.method, 'PUT')
		assert.equal(upload.url, 'https://dav.example.test/root/music%20backups/Cymusic.json')
		assert.equal(upload.options.headers['Content-Type'], 'application/octet-stream')
		assert.equal(
			upload.options.headers.Authorization,
			`Basic ${Buffer.from('张三:secret').toString('base64')}`,
		)
		assert.equal(JSON.parse(upload.options.body).format, 'zhmusic-backup')
	},
)

await check('missing directories and missing backup files have actionable error codes', async () => {
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
})

await check('connection test rejects a readable but unwritable backup directory', async () => {
	nextResponse = [response(207), response(403)]
	await assert.rejects(
		webdav.testWebDavConnection(config),
		(error) => error.code === 'unauthorized' && error.status === 403,
	)
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

finish()
