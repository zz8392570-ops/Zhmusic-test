import PersistStatus from '@/store/PersistStatus'
import { waitForRequest, throwIfRequestAborted } from '@/helpers/requestControl'
import {
	musicApiSelectedStore,
	musicApiStore,
	musicApiTestingStore,
	nowApiState,
} from '@/player/PlayerStore'
import { showToast } from '@/utils/utils'
import { showAutomaticSourceSwitchNotice } from '@/utils/sourceSwitchNotice'
import { Alert } from 'react-native'
import { logError, logInfo } from '../logger'
import { BUNDLED_SOURCES_VERSION, loadBundledMusicApiStubs } from './builtinMusicSources'
import {
	HEALTH_TEST_QUALITY,
	HEALTH_TEST_TIMEOUT_MS,
	HEALTH_TEST_TRACKS,
	classifyMusicApiHealth,
	createTestingHealth,
	getFailoverCandidates,
	isValidMusicUrl,
	sortMusicApis,
} from './musicSourceHealth'
import { disposeLxMusicScript, isLxMusicScript, reloadLxMusicScript } from './lxMusicSourceAdapter'

type SelectMusicApiOptions = {
	silent?: boolean
	notify?: boolean
	signal?: AbortSignal
	isCurrent?: () => boolean
}

type AddMusicApiOptions = {
	silent?: boolean
	autoTest?: boolean
}

const failedApiByMusicId = new Map<string, Set<string>>()

export const getMusicFailureKey = (musicItem: IMusic.IMusicItem) =>
	`${String(musicItem.platform || 'unknown').toLowerCase()}:${musicItem.id}`
let loadedRuntimeId: string | null = null
let selectionRevision = 0
let runtimeLock: Promise<void> = Promise.resolve()
let healthQueue: Promise<void> = Promise.resolve()

const withSourceRuntime = <T>(fn: () => Promise<T>): Promise<T> => {
	const run = runtimeLock.then(fn, fn)
	runtimeLock = run.then(
		() => undefined,
		() => undefined,
	)
	return run
}

const enqueueHealthWork = (fn: () => Promise<void>) => {
	healthQueue = healthQueue.then(fn, fn)
	return healthQueue
}

const persistApiList = (list: IMusic.MusicApi[], shouldSort = false) => {
	const next = shouldSort ? sortMusicApis(list) : list
	musicApiStore.setValue(next)
	PersistStatus.set('music.musicApi', next)
	return next
}

const patchMusicApi = (id: string, patch: Partial<IMusic.MusicApi>, shouldSort = false) => {
	const list = musicApiStore.getValue() || []
	const next = persistApiList(
		list.map((api) => (api.id === id ? { ...api, ...patch } : api)),
		shouldSort,
	)
	const selected = musicApiSelectedStore.getValue()
	if (selected?.id === id) {
		const updated = { ...selected, ...patch }
		musicApiSelectedStore.setValue(updated)
		PersistStatus.set('music.selectedMusicApi', updated)
	}
	return next.find((api) => api.id === id)
}

export const rememberFailedApi = (musicId: string, apiId: string) => {
	const failed = failedApiByMusicId.get(musicId) ?? new Set<string>()
	failed.add(apiId)
	failedApiByMusicId.set(musicId, failed)
}

export const getFailedApiIds = (musicId: string): Set<string> =>
	failedApiByMusicId.get(musicId) ?? new Set<string>()

export const clearFailedApis = (musicId?: string) => {
	if (musicId) {
		failedApiByMusicId.delete(musicId)
		return
	}
	failedApiByMusicId.clear()
}

export const reloadMusicApi = async (
	musicApi: IMusic.MusicApi,
	isTest: boolean = false,
): Promise<IMusic.MusicApi> => {
	if (!musicApi.isSelected && !isTest) {
		return musicApi
	}

	try {
		if (musicApi.scriptType === 'lxmusic' || isLxMusicScript(musicApi.script)) {
			return await reloadLxMusicScript(musicApi)
		}

		const context: any = {
			module: { exports: {} },
			exports: {},
			require: () => {},
		}
		const scriptFunction = new Function('module', 'exports', 'require', musicApi.script)
		scriptFunction.call(context, context.module, context.exports, context.require)
		if (!isTest) disposeLxMusicScript()
		loadedRuntimeId = musicApi.id

		return {
			...musicApi,
			getMusicUrl: context.module.exports.getMusicUrl || musicApi.getMusicUrl,
		}
	} catch (error) {
		logError(`Error reloading script for API "${musicApi.name}":`, error)
		return musicApi
	}
}

export const ensureApiRuntime = async (api: IMusic.MusicApi): Promise<IMusic.MusicApi> => {
	if (loadedRuntimeId === api.id && typeof api.getMusicUrl === 'function') {
		return api
	}
	const reloaded = await reloadMusicApi(api, true)
	loadedRuntimeId = api.id
	if (musicApiSelectedStore.getValue()?.id === api.id) {
		musicApiSelectedStore.setValue(reloaded)
	}
	return reloaded
}

export const requestMusicUrlFromApi = async (
	api: IMusic.MusicApi,
	musicItem: IMusic.IMusicItem,
	quality: IMusic.IQualityKey,
	timeoutMs: number,
	requestContext?: object,
	signal?: AbortSignal,
): Promise<string | null> => {
	throwIfRequestAborted(signal)
	const attempt = new AbortController()
	const onAbort = () => attempt.abort(signal?.reason)
	signal?.addEventListener('abort', onAbort, { once: true })
	const timer = setTimeout(() => {
		const error = new Error('请求超时')
		error.name = 'TimeoutError'
		attempt.abort(error)
	}, timeoutMs)
	try {
		return await waitForRequest(
			() =>
				withSourceRuntime(async () => {
					throwIfRequestAborted(attempt.signal)
					const ready = await ensureApiRuntime(api)
					throwIfRequestAborted(attempt.signal)
					if (typeof ready.getMusicUrl !== 'function') return null
					const enrichedRequestContext = {
						...requestContext,
						platform: musicItem.platform,
						musicItem,
						signal: attempt.signal,
					}
					const url = await waitForRequest(
						() =>
							ready.getMusicUrl(
								musicItem.title,
								musicItem.artist,
								musicItem.id,
								quality,
								enrichedRequestContext,
							),
						timeoutMs,
						attempt.signal,
					)
					return typeof url === 'string' && isValidMusicUrl(url) ? url : null
				}),
			timeoutMs,
			attempt.signal,
		)
	} finally {
		clearTimeout(timer)
		signal?.removeEventListener('abort', onAbort)
	}
}

export const restoreSelectedRuntime = async () => {
	const selected = musicApiSelectedStore.getValue()
	if (!selected) return null
	return withSourceRuntime(() => ensureApiRuntime(selected))
}

export const setMusicApiAsSelectedById = async (
	musicApiId: string,
	options: SelectMusicApiOptions = {},
) => {
	const revision = ++selectionRevision
	try {
		throwIfRequestAborted(options.signal)
		const musicApis: IMusic.MusicApi[] = musicApiStore.getValue() || []
		const targetApiIndex = musicApis.findIndex((api) => api.id === musicApiId)
		if (targetApiIndex === -1) {
			logError(`Music API with id ${musicApiId} not found`)
			if (!options.silent) Alert.alert('错误', '未找到指定的音源')
			return
		}

		const selectedApi = musicApis[targetApiIndex]
		const reloadedApi = await withSourceRuntime(() => {
			throwIfRequestAborted(options.signal)
			return ensureApiRuntime({ ...selectedApi, isSelected: true })
		})
		throwIfRequestAborted(options.signal)
		if (revision !== selectionRevision || options.isCurrent?.() === false) return
		persistApiList(
			(musicApiStore.getValue() || []).map((api) => ({
				...(api.id === musicApiId ? reloadedApi : api),
				isSelected: api.id === musicApiId,
			})),
		)
		musicApiSelectedStore.setValue(reloadedApi)
		PersistStatus.set('music.selectedMusicApi', reloadedApi)
		nowApiState.setValue(reloadedApi.health?.status === 'dead' ? '异常' : '正常')
		logInfo(`Music API "${reloadedApi.name}" set as selected and reloaded successfully`)
		if (!options.silent) {
			Alert.alert('成功', `音源 "${reloadedApi.name}" 已设置为当前选中并重新加载`)
		} else if (options.notify !== false) {
			showToast('已切换至 ' + reloadedApi.name, '', 'info')
		}
		return reloadedApi
	} catch (error) {
		throwIfRequestAborted(options.signal)
		logError('Error setting music API as selected:', error)
		if (!options.silent) Alert.alert('错误', '设置选中音源时发生错误')
	}
}

const maybeSwitchFromDeadSelected = async () => {
	const selected = musicApiSelectedStore.getValue()
	if (!selected || selected.health?.status !== 'dead') return
	const best = sortMusicApis(musicApiStore.getValue() || []).find(
		(api) =>
			api.id !== selected.id &&
			(api.health?.status === 'normal' || api.health?.status === 'partial'),
	)
	if (!best) return
	const switchedSource = await setMusicApiAsSelectedById(best.id, { silent: true, notify: false })
	if (switchedSource) {
		showAutomaticSourceSwitchNotice({
			fromSource: selected.name,
			toSource: best.name,
			reason: 'healthCheckFailed',
		})
	}
}

const testMusicApiInternal = async (apiId: string) => {
	const api = (musicApiStore.getValue() || []).find((item) => item.id === apiId)
	if (!api) return
	patchMusicApi(apiId, { health: createTestingHealth(api.health) })
	try {
		let successCount = 0
		const latencies: number[] = []
		for (const track of HEALTH_TEST_TRACKS) {
			const startedAt = Date.now()
			try {
				const url = await withSourceRuntime(async () => {
					const ready = await ensureApiRuntime(api)
					if (typeof ready.getMusicUrl !== 'function') return null
					return Promise.race([
						ready.getMusicUrl(track.title, track.artist, track.id, HEALTH_TEST_QUALITY),
						new Promise<never>((_, reject) => {
							setTimeout(() => reject(new Error('请求超时')), HEALTH_TEST_TIMEOUT_MS)
						}),
					])
				})
				if (isValidMusicUrl(url)) {
					successCount += 1
					latencies.push(Date.now() - startedAt)
				}
			} catch {
				// Counted as a failed probe.
			}
		}
		const health: IMusic.MusicApiHealth = {
			successCount,
			totalCount: HEALTH_TEST_TRACKS.length,
			latencyMs: latencies.length
				? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
				: null,
			status: classifyMusicApiHealth(successCount, HEALTH_TEST_TRACKS.length),
			testedAt: Date.now(),
		}
		patchMusicApi(apiId, { health }, true)
		logInfo(
			`音源 ${api.name} 测试完成: ${health.successCount}/${health.totalCount} ${health.latencyMs ?? '-'}ms`,
		)
	} catch (error) {
		logError(`测试音源 ${api.name} 失败:`, error)
		patchMusicApi(
			apiId,
			{
				health: {
					successCount: 0,
					totalCount: api.health?.totalCount || 0,
					latencyMs: null,
					status: 'dead',
					testedAt: Date.now(),
				},
			},
			true,
		)
	} finally {
		await restoreSelectedRuntime()
	}
}

export const testMusicApiById = (apiId: string) =>
	enqueueHealthWork(() => testMusicApiInternal(apiId))

export const testAllMusicApis = () =>
	enqueueHealthWork(async () => {
		const apis = musicApiStore.getValue() || []
		if (!apis.length || musicApiTestingStore.getValue()) return
		musicApiTestingStore.setValue(true)
		try {
			for (const api of [...apis]) {
				await testMusicApiInternal(api.id)
			}
			await maybeSwitchFromDeadSelected()
		} finally {
			musicApiTestingStore.setValue(false)
			await restoreSelectedRuntime()
		}
	})

export const runBackgroundHealthTests = () =>
	enqueueHealthWork(async () => {
		const untested = (musicApiStore.getValue() || []).filter(
			(api) => !api.health || api.health.status === 'idle',
		)
		if (!untested.length) {
			persistApiList(musicApiStore.getValue() || [], true)
			return
		}
		musicApiTestingStore.setValue(true)
		try {
			for (const api of untested) {
				await testMusicApiInternal(api.id)
			}
			await maybeSwitchFromDeadSelected()
		} finally {
			musicApiTestingStore.setValue(false)
			await restoreSelectedRuntime()
		}
	})

export const addMusicApi = (musicApi: IMusic.MusicApi, options: AddMusicApiOptions = {}) => {
	try {
		const nowMusicApiList = musicApiStore.getValue() || []
		const existingApiIndex = nowMusicApiList.findIndex(
			(existingApi) => existingApi.id === musicApi.id,
		)
		const shouldAutoTest = options.autoTest !== false

		if (existingApiIndex !== -1) {
			if (options.silent) {
				const updatedMusicApiList = [...nowMusicApiList]
				updatedMusicApiList[existingApiIndex] = {
					...musicApi,
					isSelected: updatedMusicApiList[existingApiIndex].isSelected,
					builtinKey: updatedMusicApiList[existingApiIndex].builtinKey,
					health: updatedMusicApiList[existingApiIndex].health,
				}
				persistApiList(updatedMusicApiList)
				if (shouldAutoTest) void testMusicApiById(musicApi.id)
				return
			}
			Alert.alert('是否覆盖', `已经存在该音源，是否覆盖？`, [
				{
					text: '确定',
					onPress: () => {
						const updatedMusicApiList = [...nowMusicApiList]
						updatedMusicApiList[existingApiIndex] = {
							...musicApi,
							isSelected: updatedMusicApiList[existingApiIndex].isSelected,
							builtinKey: updatedMusicApiList[existingApiIndex].builtinKey,
						}
						persistApiList(updatedMusicApiList)
						logInfo('Music API updated successfully')
						Alert.alert('成功', '音源更新成功', [
							{ text: '确定', onPress: () => logInfo('Update alert closed') },
						])
						if (shouldAutoTest) void testMusicApiById(musicApi.id)
					},
				},
				{ text: '取消', onPress: () => {}, style: 'cancel' },
			])
			return
		}

		const updatedMusicApiList = [...nowMusicApiList, musicApi]
		persistApiList(updatedMusicApiList)
		if (!nowMusicApiList.length) {
			logInfo('音源为空，自动选择')
			void setMusicApiAsSelectedById(musicApi.id, { silent: true, notify: false })
		}
		logInfo('音源导入成功')
		if (!options.silent) {
			Alert.alert('成功', '音源导入成功', [
				{ text: '确定', onPress: () => logInfo('Add alert closed') },
			])
		}
		if (shouldAutoTest) void testMusicApiById(musicApi.id)
	} catch (error) {
		logError('Error adding/updating music API:', error)
		if (!options.silent) {
			Alert.alert('失败', '音源导入/更新失败', [
				{ text: '确定', onPress: () => logInfo('Error alert closed') },
			])
		}
	}
}

export const deleteMusicApiById = (musicApiId: string, options: { silent?: boolean } = {}) => {
	const selectedMusicApi = musicApiSelectedStore.getValue()
	const musicApis = musicApiStore.getValue() || []
	const target = musicApis.find((musicApi) => musicApi.id === musicApiId)
	if (selectedMusicApi?.id === musicApiId) {
		musicApiSelectedStore.setValue(null)
		PersistStatus.set('music.selectedMusicApi', undefined)
		if (loadedRuntimeId === musicApiId) loadedRuntimeId = null
	}
	persistApiList(musicApis.filter((musicApi) => musicApi.id !== musicApiId))
	if (target?.builtinKey) {
		const removed = PersistStatus.get('music.removedBuiltinSources') ?? []
		if (!removed.includes(target.builtinKey)) {
			PersistStatus.set('music.removedBuiltinSources', [...removed, target.builtinKey])
		}
	}
	logInfo('Music API deleted successfully')
	if (!options.silent) {
		Alert.alert('成功', '音源删除成功', [
			{ text: '确定', onPress: () => logInfo('Add alert closed') },
		])
	}
}

export const getPlaybackFailoverApis = (musicItem: IMusic.IMusicItem) => {
	const selected = musicApiSelectedStore.getValue()
	return getFailoverCandidates(
		musicApiStore.getValue() || [],
		selected?.id,
		getFailedApiIds(getMusicFailureKey(musicItem)),
	)
}

export const seedBundledMusicSources = async () => {
	const existing = musicApiStore.getValue() || []
	const version = PersistStatus.get('music.bundledSourcesVersion') ?? 0
	const shouldReseedEmpty = existing.length === 0
	if (version >= BUNDLED_SOURCES_VERSION && !shouldReseedEmpty) return

	const bundled = await loadBundledMusicApiStubs()
	const removed = PersistStatus.get('music.removedBuiltinSources') ?? []
	const next = [...existing]
	for (const stub of bundled) {
		const alreadyHas = next.some(
			(api) => api.builtinKey === stub.builtinKey || api.id === stub.id || api.name === stub.name,
		)
		if (alreadyHas) continue
		if (!shouldReseedEmpty && stub.builtinKey && removed.includes(stub.builtinKey)) continue
		next.push(stub)
	}
	persistApiList(next)
	PersistStatus.set('music.bundledSourcesVersion', BUNDLED_SOURCES_VERSION)
	if (shouldReseedEmpty) {
		PersistStatus.set('music.removedBuiltinSources', [])
	}
	logInfo(`已注入内嵌音源，当前共 ${next.length} 个`)
}
