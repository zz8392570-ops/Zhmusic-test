import { MAX_BACKUP_BYTES, parseMusicBackup, type MusicBackup } from '@/helpers/musicBackup'
import { Buffer } from 'buffer'
import * as SecureStore from 'expo-secure-store'

const CONFIG_KEY = 'cymusic.webdav.backup'
const REQUEST_TIMEOUT_MS = 20_000

export interface WebDavBackupConfig {
	url: string
	username: string
	password: string
	remotePath: string
}

export type WebDavErrorCode =
	| 'invalid-config'
	| 'unauthorized'
	| 'not-found'
	| 'directory-not-found'
	| 'backup-not-found'
	| 'too-large'
	| 'invalid-backup'
	| 'timeout'
	| 'request-failed'

export class WebDavBackupError extends Error {
	constructor(
		public readonly code: WebDavErrorCode,
		public readonly status?: number,
	) {
		super(code)
		this.name = 'WebDavBackupError'
	}
}

const normalizeConfig = (config: WebDavBackupConfig): WebDavBackupConfig => {
	let url: URL
	try {
		url = new URL(config.url.trim())
	} catch {
		throw new WebDavBackupError('invalid-config')
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
		throw new WebDavBackupError('invalid-config')
	url.hash = ''
	const remotePath = config.remotePath.trim().replace(/^\/+|\/+$/g, '')
	const segments = remotePath.split('/').filter(Boolean)
	if (!segments.length || segments.some((segment) => segment === '.' || segment === '..'))
		throw new WebDavBackupError('invalid-config')
	return {
		url: url.toString().replace(/\/$/, ''),
		username: config.username.trim(),
		password: config.password,
		remotePath: segments.join('/'),
	}
}

const isConfig = (value: unknown): value is WebDavBackupConfig => {
	if (!value || typeof value !== 'object') return false
	const config = value as WebDavBackupConfig
	return ['url', 'username', 'password', 'remotePath'].every(
		(key) => typeof config[key as keyof WebDavBackupConfig] === 'string',
	)
}

export const loadWebDavBackupConfig = async (): Promise<WebDavBackupConfig | null> => {
	const raw = await SecureStore.getItemAsync(CONFIG_KEY)
	if (raw === null) return null
	let value: unknown
	try {
		value = JSON.parse(raw)
	} catch {
		throw new WebDavBackupError('invalid-config')
	}
	if (!isConfig(value)) throw new WebDavBackupError('invalid-config')
	return normalizeConfig(value)
}

export const saveWebDavBackupConfig = async (config: WebDavBackupConfig) => {
	const normalized = normalizeConfig(config)
	await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(normalized))
	return normalized
}

const authHeaders = (config: WebDavBackupConfig) => ({
	Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64')}`,
})

const remoteUrl = (config: WebDavBackupConfig) => {
	const path = config.remotePath.split('/').map(encodeURIComponent).join('/')
	const url = new URL(config.url)
	url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`
	return url.toString()
}

const parentUrl = (config: WebDavBackupConfig) => {
	const segments = config.remotePath.split('/')
	segments.pop()
	if (!segments.length) return `${config.url}/`
	const url = new URL(config.url)
	url.pathname = `${url.pathname.replace(/\/$/, '')}/${segments.map(encodeURIComponent).join('/')}/`
	return url.toString()
}

const childUrl = (parent: string, name: string) => new URL(encodeURIComponent(name), parent).toString()

const request = async (url: string, options: RequestInit) => {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
	try {
		return await fetch(url, { ...options, signal: controller.signal })
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError')
			throw new WebDavBackupError('timeout')
		throw new WebDavBackupError('request-failed')
	} finally {
		clearTimeout(timer)
	}
}

const requireSuccess = (
	response: Response,
	notFoundCode: Extract<WebDavErrorCode, 'not-found' | 'directory-not-found' | 'backup-not-found'> =
		'not-found',
) => {
	if (response.ok || response.status === 207) return
	if (response.status === 401 || response.status === 403)
		throw new WebDavBackupError('unauthorized', response.status)
	if (response.status === 404) throw new WebDavBackupError(notFoundCode, response.status)
	throw new WebDavBackupError('request-failed', response.status)
}

export const testWebDavConnection = async (input: WebDavBackupConfig) => {
	const config = normalizeConfig(input)
	const directoryUrl = parentUrl(config)
	const response = await request(directoryUrl, {
		method: 'PROPFIND',
		headers: { ...authHeaders(config), Depth: '0' },
	})
	requireSuccess(response, 'directory-not-found')
	// Read access to the WebDAV root does not prove that the configured backup
	// directory is writable. Use a small reversible probe in that exact directory.
	// Some WebDAV providers, including Nutstore, reject dot-prefixed files even
	// when the parent directory exists and is writable.
	const probeUrl = childUrl(directoryUrl, `ZhMusic-write-test-${Date.now()}.tmp`)
	const probe = await request(probeUrl, {
		method: 'PUT',
		headers: { ...authHeaders(config), 'Content-Type': 'application/octet-stream' },
		body: 'ZhMusic WebDAV write test',
	})
	requireSuccess(probe)
	const cleanup = await request(probeUrl, { method: 'DELETE', headers: authHeaders(config) })
	requireSuccess(cleanup)
}

export const uploadWebDavBackup = async (input: WebDavBackupConfig, backup: MusicBackup) => {
	const config = normalizeConfig(input)
	let text: string
	try {
		text = JSON.stringify(parseMusicBackup(JSON.stringify(backup)), null, 2)
	} catch {
		throw new WebDavBackupError('invalid-backup')
	}
	const directory = await request(parentUrl(config), {
		method: 'PROPFIND',
		headers: { ...authHeaders(config), Depth: '0' },
	})
	requireSuccess(directory, 'directory-not-found')
	const response = await request(remoteUrl(config), {
		method: 'PUT',
		headers: { ...authHeaders(config), 'Content-Type': 'application/octet-stream' },
		body: text,
	})
	requireSuccess(response, 'directory-not-found')
}

export const downloadWebDavBackup = async (input: WebDavBackupConfig): Promise<MusicBackup> => {
	const config = normalizeConfig(input)
	const response = await request(remoteUrl(config), {
		method: 'GET',
		headers: authHeaders(config),
	})
	requireSuccess(response, 'backup-not-found')
	const contentLength = Number(response.headers.get('content-length'))
	if (Number.isFinite(contentLength) && contentLength > MAX_BACKUP_BYTES)
		throw new WebDavBackupError('too-large')
	const text = await response.text()
	if (Buffer.byteLength(text, 'utf8') > MAX_BACKUP_BYTES) throw new WebDavBackupError('too-large')
	try {
		return parseMusicBackup(text)
	} catch {
		throw new WebDavBackupError('invalid-backup')
	}
}
