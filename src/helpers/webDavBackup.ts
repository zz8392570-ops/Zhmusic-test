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

const requireSuccess = (response: Response) => {
	if (response.ok || response.status === 207) return
	if (response.status === 401 || response.status === 403)
		throw new WebDavBackupError('unauthorized', response.status)
	if (response.status === 404) throw new WebDavBackupError('not-found', response.status)
	throw new WebDavBackupError('request-failed', response.status)
}

export const testWebDavConnection = async (input: WebDavBackupConfig) => {
	const config = normalizeConfig(input)
	const response = await request(config.url, {
		method: 'PROPFIND',
		headers: { ...authHeaders(config), Depth: '0' },
	})
	requireSuccess(response)
}

export const uploadWebDavBackup = async (input: WebDavBackupConfig, backup: MusicBackup) => {
	const config = normalizeConfig(input)
	const text = JSON.stringify(parseMusicBackup(JSON.stringify(backup)), null, 2)
	const response = await request(remoteUrl(config), {
		method: 'PUT',
		headers: { ...authHeaders(config), 'Content-Type': 'application/json; charset=utf-8' },
		body: text,
	})
	requireSuccess(response)
}

export const downloadWebDavBackup = async (input: WebDavBackupConfig): Promise<MusicBackup> => {
	const config = normalizeConfig(input)
	const response = await request(remoteUrl(config), {
		method: 'GET',
		headers: authHeaders(config),
	})
	requireSuccess(response)
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
