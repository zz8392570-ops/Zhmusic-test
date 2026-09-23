import PersistStatus from '@/store/PersistStatus'
import * as SecureStore from 'expo-secure-store'
import type { LxSyncKeyInfo } from './lxSyncTypes'

const CREDENTIALS_KEY = 'cymusic.lxSync.credentials'

export interface LxSyncCredentials {
	serverId: string
	keyInfo: LxSyncKeyInfo
}

const isCredentials = (value: unknown): value is LxSyncCredentials => {
	if (!value || typeof value !== 'object') return false
	const credentials = value as LxSyncCredentials
	return (
		typeof credentials.serverId === 'string' &&
		!!credentials.serverId &&
		typeof credentials.keyInfo?.clientId === 'string' &&
		!!credentials.keyInfo.clientId &&
		typeof credentials.keyInfo.key === 'string' &&
		!!credentials.keyInfo.key &&
		typeof credentials.keyInfo.serverName === 'string'
	)
}

export const getLxSyncCredentials = async (): Promise<LxSyncCredentials | null> => {
	const raw = await SecureStore.getItemAsync(CREDENTIALS_KEY)
	if (raw !== null) {
		let credentials: unknown
		try {
			credentials = JSON.parse(raw)
		} catch {
			throw new Error('已保存的同步凭据损坏，请清除配对后重新连接')
		}
		if (!isCredentials(credentials)) throw new Error('已保存的同步凭据损坏，请清除配对后重新连接')
		if (PersistStatus.get('sync.credentials')) PersistStatus.set('sync.credentials', undefined)
		return credentials
	}

	const legacy = PersistStatus.get('sync.credentials')
	if (!legacy) return null
	if (!isCredentials(legacy)) throw new Error('旧同步凭据损坏，请清除配对后重新连接')
	await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(legacy))
	PersistStatus.set('sync.credentials', undefined)
	return legacy
}

export const saveLxSyncCredentials = async (credentials: LxSyncCredentials) => {
	if (!isCredentials(credentials)) throw new Error('同步服务返回了无效凭据')
	await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials))
	PersistStatus.set('sync.credentials', undefined)
}

export const clearLxSyncCredentials = async () => {
	PersistStatus.set('sync.credentials', undefined)
	await SecureStore.deleteItemAsync(CREDENTIALS_KEY)
	PersistStatus.set('sync.lastSuccessAt', undefined)
}
