import PersistStatus from '@/store/PersistStatus'
import * as Network from 'expo-network'
import { AppState, type AppStateStatus } from 'react-native'
import { getLxSyncCredentials } from './lxSyncCredentials'
import { syncWithLxServer } from './lxSyncClient'

const MIN_SYNC_INTERVAL_MS = 60_000
const STARTUP_DELAY_MS = 2_000
const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000, 300_000] as const

let started = false
let appState: AppStateStatus = AppState.currentState
let retryIndex = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
let autoSyncPromise: Promise<void> | null = null

const clearRetry = () => {
	if (retryTimer) clearTimeout(retryTimer)
	retryTimer = null
}

const canUseNetwork = (state: Network.NetworkState) => {
	if (state.isConnected === false || state.type === Network.NetworkStateType.NONE) return false
	if (PersistStatus.get('sync.autoWifiOnly') === true) {
		return state.type === Network.NetworkStateType.WIFI || state.type === Network.NetworkStateType.ETHERNET
	}
	return true
}

const scheduleRetry = () => {
	clearRetry()
	if (
		retryIndex >= RETRY_DELAYS_MS.length ||
		appState !== 'active' ||
		PersistStatus.get('sync.autoEnabled') !== true
	)
		return
	const delay = RETRY_DELAYS_MS[retryIndex++]
	retryTimer = setTimeout(() => {
		retryTimer = null
		void runAutoSync(true)
	}, delay)
}

const runAutoSync = async (isRetry = false) => {
	if (autoSyncPromise) return autoSyncPromise
	autoSyncPromise = (async () => {
		try {
			if (appState !== 'active' || PersistStatus.get('sync.autoEnabled') !== true) return
			const host = PersistStatus.get('sync.host')?.trim()
			if (!host || !(await getLxSyncCredentials())) return
			const networkState = await Network.getNetworkStateAsync()
			if (!canUseNetwork(networkState)) return
			const lastSuccessAt = PersistStatus.get('sync.lastSuccessAt') ?? 0
			if (!isRetry && Date.now() - lastSuccessAt < MIN_SYNC_INTERVAL_MS) return

			await syncWithLxServer({ host, mode: 'merge_local_remote' })
			retryIndex = 0
			clearRetry()
			PersistStatus.set('sync.lastAutoError', undefined)
		} catch (error) {
			PersistStatus.set(
				'sync.lastAutoError',
				error instanceof Error ? error.message : '自动同步失败',
			)
			scheduleRetry()
		}
	})().finally(() => {
		autoSyncPromise = null
	})
	return autoSyncPromise
}

export const requestLxAutoSync = () => {
	retryIndex = 0
	clearRetry()
	void runAutoSync()
}

export const stopLxAutoSyncRetries = () => {
	retryIndex = 0
	clearRetry()
}

export const startLxAutoSync = () => {
	if (started) return () => undefined
	started = true
	appState = AppState.currentState
	const startupTimer = setTimeout(requestLxAutoSync, STARTUP_DELAY_MS)
	const appStateSubscription = AppState.addEventListener('change', (nextState) => {
		const returnedToForeground = appState !== 'active' && nextState === 'active'
		appState = nextState
		if (returnedToForeground) requestLxAutoSync()
		else if (nextState !== 'active') clearRetry()
	})
	const networkSubscription = Network.addNetworkStateListener((state) => {
		if (canUseNetwork(state)) requestLxAutoSync()
	})

	return () => {
		started = false
		clearTimeout(startupTimer)
		clearRetry()
		appStateSubscription.remove()
		networkSubscription.remove()
	}
}
