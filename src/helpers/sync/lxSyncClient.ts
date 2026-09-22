import PersistStatus from '@/store/PersistStatus'
import { Platform } from 'react-native'
import { createMsg2call } from 'message2call'
import forge from 'node-forge'
import { gzip, ungzip } from 'pako'
import { applyRemoteListAction, getLocalListData, setLocalListData } from './lxSyncData'
import type { LxListData, LxSyncKeyInfo, LxSyncMode } from './lxSyncTypes'

const HELLO = 'Hello~::^-^::~v4~'
const ID_PREFIX = 'OjppZDo6'
const AUTH_MESSAGE = 'lx-music auth::'
const CONNECT_MESSAGE = 'lx-music connect'
const CLOSE_FAILED = 4100

interface UrlInfo {
	httpProtocol: 'http:' | 'https:'
	wsProtocol: 'ws:' | 'wss:'
	hostPath: string
}

interface SyncOptions {
	host: string
	authCode?: string
	mode: LxSyncMode
	onStatus?: (status: string) => void
}

const getDeviceName = () => {
	const constants = Platform.constants as unknown as Record<string, unknown>
	const model = constants.Model ?? constants.model ?? constants.systemName
	return model ? `${String(model)} Cymusic` : `${Platform.OS} Cymusic`
}

const parseUrl = (host: string): UrlInfo => {
	let href = host.trim().replace(/\/$/, '')
	if (!/^https?:\/\//i.test(href)) href = `http://${href}`
	const url = new URL(href)
	return {
		httpProtocol: url.protocol === 'https:' ? 'https:' : 'http:',
		wsProtocol: url.protocol === 'https:' ? 'wss:' : 'ws:',
		hostPath: `${url.host}${url.pathname.replace(/\/$/, '')}`,
	}
}

const toBase64 = (bytes: Uint8Array) => {
	let binary = ''
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
	}
	return forge.util.encode64(binary)
}
const fromBase64 = (value: string) => Uint8Array.from(forge.util.decode64(value), (char) => char.charCodeAt(0))

export const aesEncrypt = (text: string, base64Key: string) => {
	const cipher = forge.cipher.createCipher('AES-ECB', forge.util.decode64(base64Key))
	cipher.start()
	cipher.update(forge.util.createBuffer(forge.util.encodeUtf8(text), 'raw'))
	if (!cipher.finish()) throw new Error('AES encrypt failed')
	return forge.util.encode64(cipher.output.getBytes())
}

export const aesDecrypt = (text: string, base64Key: string) => {
	const decipher = forge.cipher.createDecipher('AES-ECB', forge.util.decode64(base64Key))
	decipher.start()
	decipher.update(forge.util.createBuffer(forge.util.decode64(text), 'raw'))
	if (!decipher.finish()) throw new Error('AES decrypt failed')
	return forge.util.decodeUtf8(decipher.output.getBytes())
}

const requestText = async (url: string, options: RequestInit = {}) => {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), 12_000)
	try {
		const response = await fetch(url, { ...options, signal: controller.signal })
		return { text: await response.text(), status: response.status }
	} finally {
		clearTimeout(timer)
	}
}

const generateRsaKeyPair = () =>
	new Promise<forge.pki.rsa.KeyPair>((resolve, reject) => {
		forge.pki.rsa.generateKeyPair({ bits: 2048, workers: 0 }, (error, keypair) => {
			if (error) reject(error)
			else resolve(keypair)
		})
	})

const authenticate = async (url: UrlInfo, authCode?: string): Promise<LxSyncKeyInfo> => {
	const base = `${url.httpProtocol}//${url.hostPath}`
	const hello = await requestText(`${base}/hello`)
	if (hello.text !== HELLO) throw new Error('同步服务版本不兼容')
	const idResponse = await requestText(`${base}/id`)
	if (!idResponse.text.startsWith(ID_PREFIX)) throw new Error('无法获取同步服务标识')
	const serverId = idResponse.text.slice(ID_PREFIX.length)
	const saved = PersistStatus.get('sync.credentials')

	if (!authCode && saved?.serverId === serverId) {
		const message = aesEncrypt(`${AUTH_MESSAGE}${getDeviceName()}`, saved.keyInfo.key)
		const result = await requestText(`${base}/ah`, {
			headers: { i: saved.keyInfo.clientId, m: message },
		})
		if (result.status !== 200 || aesDecrypt(result.text, saved.keyInfo.key) !== HELLO) {
			throw new Error('已保存的同步凭据失效，请重新输入连接码')
		}
		return saved.keyInfo
	}

	if (!authCode?.trim()) throw new Error('首次连接需要输入连接码')
	const key = forge.util.encode64(
		forge.md.md5.create().update(authCode.trim(), 'utf8').digest().toHex().slice(0, 16),
	)
	const pair = await generateRsaKeyPair()
	const publicKey = forge.pki.publicKeyToPem(pair.publicKey).replace(/\r?\n/g, '')
		.replace('-----BEGIN PUBLIC KEY-----', '')
		.replace('-----END PUBLIC KEY-----', '')
	const message = aesEncrypt(
		`${AUTH_MESSAGE}\n${publicKey}\n${getDeviceName()}\nlx_music_mobile`,
		key,
	)
	const result = await requestText(`${base}/ah`, { headers: { m: message } })
	if (result.status !== 200) throw new Error(result.text || '连接码验证失败')
	let decrypted: string
	try {
		decrypted = pair.privateKey.decrypt(forge.util.decode64(result.text), 'RSA-OAEP', {
			md: forge.md.sha1.create(),
			mgf1: { md: forge.md.sha1.create() },
		})
	} catch {
		throw new Error('连接码验证失败')
	}
	const keyInfo = JSON.parse(decrypted) as LxSyncKeyInfo
	PersistStatus.set('sync.credentials', { serverId, keyInfo })
	return keyInfo
}

const encodeMessage = (message: string) =>
	message.length > 1024 ? `cg_${toBase64(gzip(message))}` : message

const decodeMessage = (message: string) =>
	message.startsWith('cg_') ? ungzip(fromBase64(message.slice(3)), { to: 'string' }) : message

export const syncWithLxServer = async ({ host, authCode, mode, onStatus }: SyncOptions) => {
	const url = parseUrl(host)
	onStatus?.('正在验证同步服务…')
	const keyInfo = await authenticate(url, authCode)
	PersistStatus.set('sync.host', host.trim().replace(/\/$/, ''))
	onStatus?.('正在同步歌单…')

	return new Promise<{ serverName: string }>((resolve, reject) => {
		const socket = new WebSocket(
			`${url.wsProtocol}//${url.hostPath}/socket?i=${encodeURIComponent(keyInfo.clientId)}&t=${encodeURIComponent(aesEncrypt(CONNECT_MESSAGE, keyInfo.key))}`,
		)
		let settled = false
		const finish = (error?: Error) => {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			rpc.destroy()
			try {
				socket.close(error ? CLOSE_FAILED : 1000)
			} catch {
				// The socket may already be closed by the server.
			}
			if (error) reject(error)
			else resolve({ serverName: keyInfo.serverName })
		}
		const rpc = createMsg2call<any>({
			timeout: 120_000,
			funcsObj: {
				async getEnabledFeatures(_serverType: string, supported: Record<string, number>) {
					return supported.list === 1 ? { list: { skipSnapshot: false } } : {}
				},
				async onListSyncAction(action: any) {
					applyRemoteListAction(action)
				},
				async list_sync_get_md5() {
					return forge.md.md5.create().update(JSON.stringify(getLocalListData()), 'utf8').digest().toHex()
				},
				async list_sync_get_sync_mode() {
					return mode
				},
				async list_sync_get_list_data() {
					return getLocalListData()
				},
				async list_sync_set_list_data(data: LxListData) {
					setLocalListData(data)
				},
				async list_sync_finished() {},
				async finished() {
					PersistStatus.set('sync.lastSuccessAt', Date.now())
					setTimeout(() => finish(), 50)
				},
			},
			sendMessage(data) {
				socket.send(encodeMessage(JSON.stringify(data)))
			},
			onError(error) {
				finish(error)
			},
		})
		const timeout = setTimeout(() => finish(new Error('同步超时，请检查服务器地址')), 120_000)
		socket.addEventListener('message', (event) => {
			if (event.data === 'ping') return
			if (typeof event.data !== 'string') return
			try {
				rpc.message(JSON.parse(decodeMessage(event.data)))
			} catch (error) {
				finish(error instanceof Error ? error : new Error('同步消息格式错误'))
			}
		})
		socket.addEventListener('error', () => finish(new Error('无法连接同步服务器')))
		socket.addEventListener('close', (event) => {
			if (!settled) finish(new Error(event.reason || '同步连接已断开'))
		})
	})
}

export const clearLxSyncCredentials = () => {
	PersistStatus.set('sync.credentials', undefined)
	PersistStatus.set('sync.lastSuccessAt', undefined)
}
