import fs from 'node:fs'
import path from 'node:path'
import { assert, checks, deferred, flush, loadModule, root } from './native-services-fixture.mjs'

const react = {
	useEffect() {},
	useMemo: (compute) => compute(),
	useRef: (initial) => ({ current: initial }),
	useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
	createElement: (type, props, ...children) => ({
		type,
		props: { ...props, children: children.flat() },
	}),
}
const stateMapper = loadModule('src/utils/stateMapper.ts', { react })
const plain = (value) => JSON.parse(JSON.stringify(value))

function soundFixture({ persisted, storage = new Map(), available = true } = {}) {
	if (persisted !== undefined) storage.set('music.soundEffects', plain(persisted))
	const timers = new Map()
	let nextTimer = 0
	const runTimers = () => {
		const pending = [...timers.values()]
		timers.clear()
		pending.forEach((callback) => callback())
	}
	const calls = []
	const writes = []
	const listeners = new Set()
	let failWrite = false
	let failListen = false
	let configure = async (settings) => ({
		state: settings.enabled || settings.volumeBalance ? 'active' : 'off',
		revision: settings.revision,
	})
	const native = {
		addListener(event, callback) {
			assert.equal(event, 'soundEffectsChanged')
			if (failListen) throw new Error('Native observation unavailable')
			listeners.add(callback)
			return { remove: () => listeners.delete(callback) }
		},
		configure(settings) {
			calls.push(plain(settings))
			return configure(settings)
		},
	}
	const helper = loadModule(
		'src/helpers/soundEffects.ts',
		{
			'@/store/PersistStatus': {
				get: (key) => storage.get(key) ?? null,
				set(key, value) {
					if (failWrite) throw new Error('Storage full')
					writes.push([key, plain(value)])
					storage.set(key, plain(value))
				},
			},
			'@/utils/stateMapper': stateMapper,
			'../../modules/cymusic-native/soundEffects': available ? native : null,
		},
		{
			setTimeout: (callback) => {
				const id = ++nextTimer
				timers.set(id, callback)
				return id
			},
			clearTimeout: (id) => timers.delete(id),
		},
	)
	return {
		...helper,
		runTimers,
		timers,
		calls,
		writes,
		listeners,
		storage,
		failWrite: (value) => {
			failWrite = value
		},
		failListen: (value) => {
			failListen = value
		},
		configure: (callback) => {
			configure = callback
		},
		emit: (status, revision = calls.at(-1)?.revision) =>
			listeners.forEach((listener) => listener({ ...status, revision })),
	}
}

const { check, finish } = checks()
await check(
	'first launch leaves both sound processing features disabled and all gains neutral',
	async () => {
		const h = soundFixture()
		assert.deepEqual(plain(h.soundEffectsStore.getValue()), {
			enabled: false,
			preset: 'original',
			bands: [0, 0, 0, 0, 0],
			volumeBalance: false,
		})
		assert.equal(h.calls.length, 0)
		await h.initializeSoundEffects()
		assert.equal(h.calls[0].enabled, false)
		assert.equal(h.calls[0].volumeBalance, false)
		assert.deepEqual(h.calls[0].bands, [0, 0, 0, 0, 0])
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'off')
		assert.equal(h.writes.length, 0)
	},
)
await check(
	'invalid stored gains are finite, clamped to six dB, and restored as five bands',
	() => {
		const h = soundFixture()
		const normalized = h.normalizeSoundEffects({
			enabled: 'true',
			preset: 'missing',
			bands: [999, -999, NaN, Infinity, '4', 3],
			volumeBalance: 1,
		})
		assert.deepEqual(plain(normalized), {
			enabled: false,
			preset: 'original',
			bands: [6, -6, 0, 0, 0],
			volumeBalance: false,
		})
		assert.deepEqual(plain(h.normalizeSoundEffects(null).bands), [0, 0, 0, 0, 0])
		assert.equal(h.normalizeSoundEffects({ bands: [1.26] }).bands[0], 1.3)
		const restored = soundFixture({
			persisted: {
				enabled: true,
				preset: 'custom',
				bands: [88, -88, null, '2'],
				volumeBalance: 'false',
			},
		})
		assert.deepEqual(plain(restored.soundEffectsStore.getValue().bands), [6, -6, 0, 0, 0])
		assert.equal(restored.soundEffectsStore.getValue().volumeBalance, false)
	},
)
await check(
	'saved preferences survive a fresh module instance and are applied at initialization',
	async () => {
		const h = soundFixture()
		await h.selectSoundEffectPreset('bass')
		await h.updateSoundEffects({ volumeBalance: true })
		const restarted = soundFixture({ storage: h.storage })
		assert.deepEqual(
			plain(restarted.soundEffectsStore.getValue()),
			plain(h.soundEffectsStore.getValue()),
		)
		assert.equal(restarted.calls.length, 0)
		await restarted.initializeSoundEffects()
		assert.equal(restarted.calls[0].enabled, true)
		assert.equal(restarted.calls[0].volumeBalance, true)
		assert.deepEqual(restarted.calls[0].bands, h.calls.at(-1).bands)
	},
)
await check('initialization is idempotent while pending and after it has completed', async () => {
	const h = soundFixture()
	const pending = deferred()
	h.configure(() => pending.promise)
	const first = h.initializeSoundEffects()
	const second = h.initializeSoundEffects()
	assert.equal(first, second)
	await flush()
	assert.equal(h.calls.length, 1)
	assert.equal(h.listeners.size, 1)
	pending.resolve({ state: 'off', revision: h.calls[0].revision })
	await first
	await h.initializeSoundEffects()
	assert.equal(h.calls.length, 1)
	assert.equal(h.listeners.size, 1)
})
await check(
	'storage write failure rejects without changing settings, native configuration, or saved data',
	async () => {
		const h = soundFixture()
		await h.selectSoundEffectPreset('vocal')
		const before = plain(h.soundEffectsStore.getValue())
		const beforeCalls = h.calls.length
		const beforeStatus = plain(h.soundEffectsStatusStore.getValue())
		h.failWrite(true)
		await assert.rejects(h.updateSoundEffects({ volumeBalance: true }), /Storage full/)
		assert.deepEqual(plain(h.soundEffectsStore.getValue()), before)
		assert.deepEqual(plain(h.storage.get('music.soundEffects')), before)
		assert.equal(h.calls.length, beforeCalls)
		assert.deepEqual(plain(h.soundEffectsStatusStore.getValue()), beforeStatus)
	},
)
await check(
	'the most recent selection wins over a slow initial configuration and queued presets',
	async () => {
		const h = soundFixture()
		const slow = deferred()
		h.configure(() => slow.promise)
		const first = h.initializeSoundEffects()
		await flush()
		const firstRevision = h.calls[0].revision
		const middle = h.selectSoundEffectPreset('bass')
		const last = h.selectSoundEffectPreset('vocal')
		const latest = deferred()
		h.configure(() => latest.promise)
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'waiting')
		slow.resolve({ state: 'off', revision: firstRevision })
		await flush()
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'waiting')
		h.emit({ state: 'off' }, firstRevision)
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'waiting')
		latest.resolve({ state: 'active', revision: h.calls.at(-1).revision })
		await Promise.all([first, middle, last])
		assert.equal(h.soundEffectsStore.getValue().preset, 'vocal')
		assert.equal(h.calls.at(-1).preset, 'vocal')
		assert.deepEqual(
			h.calls.at(-1).bands,
			plain(h.SOUND_EFFECT_PRESETS.find((preset) => preset.id === 'vocal').bands),
		)
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'active')
		assert.ok(h.calls.every((call) => call.preset !== 'bass'))
	},
)
await check(
	'older native events and failed older calls cannot overwrite a newer requested state',
	async () => {
		const h = soundFixture()
		await h.initializeSoundEffects()
		const slow = deferred()
		h.configure(() => slow.promise)
		const older = h.selectSoundEffectPreset('bass')
		await flush()
		const oldRevision = h.calls.at(-1).revision
		const latest = h.updateSoundEffects({ enabled: false })
		h.emit({ state: 'active' }, oldRevision)
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'off')
		const rejected = assert.rejects(older, /older native failure/)
		h.configure(async (settings) => ({ state: 'off', revision: settings.revision }))
		slow.reject(new Error('older native failure'))
		await rejected
		await latest
		h.emit({ state: 'error', reason: 'processing' }, oldRevision)
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'off')
	},
)
await check(
	'native failure keeps the saved request but exposes error and permits retry',
	async () => {
		const h = soundFixture()
		h.configure(async () => {
			throw new Error('DSP unavailable')
		})
		await assert.rejects(h.selectSoundEffectPreset('bass'), /DSP unavailable/)
		assert.equal(h.soundEffectsStore.getValue().preset, 'bass')
		assert.equal(h.storage.get('music.soundEffects').preset, 'bass')
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'error')
		assert.equal(h.soundEffectsStatusStore.getValue().reason, 'processing')
		h.configure(async (settings) => ({ state: 'active', revision: settings.revision }))
		await h.updateSoundEffects({})
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'active')
		assert.equal(h.listeners.size, 1)
	},
)
await check(
	'failed initialization can be retried without duplicate native subscriptions',
	async () => {
		const h = soundFixture()
		h.configure(async () => {
			throw new Error('not ready')
		})
		await assert.rejects(h.initializeSoundEffects(), /not ready/)
		h.configure(async (settings) => ({ state: 'off', revision: settings.revision }))
		await h.initializeSoundEffects()
		assert.equal(h.calls.length, 2)
		assert.equal(h.listeners.size, 1)
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'off')
	},
)
await check('native observation failure exposes an error and can retry subscription', async () => {
	const h = soundFixture()
	h.failListen(true)
	await assert.rejects(h.selectSoundEffectPreset('bass'), /observation unavailable/)
	assert.equal(h.soundEffectsStatusStore.getValue().state, 'error')
	assert.equal(h.listeners.size, 0)
	h.failListen(false)
	await h.updateSoundEffects({})
	assert.equal(h.listeners.size, 1)
	assert.equal(h.soundEffectsStatusStore.getValue().state, 'active')
})
await check(
	'EQ presets and volume balancing are independent, while reset disables both',
	async () => {
		const h = soundFixture()
		await h.updateSoundEffects({ volumeBalance: true })
		assert.equal(h.soundEffectsStore.getValue().enabled, false)
		await h.selectSoundEffectPreset('balanced')
		assert.equal(h.soundEffectsStore.getValue().enabled, true)
		assert.equal(h.soundEffectsStore.getValue().volumeBalance, true)
		await h.selectSoundEffectPreset('original')
		assert.equal(h.soundEffectsStore.getValue().enabled, false)
		assert.equal(h.soundEffectsStore.getValue().volumeBalance, true)
		assert.equal(h.calls.at(-1).volumeBalance, true)
		await h.resetSoundEffects()
		assert.equal(h.soundEffectsStore.getValue().volumeBalance, false)
		assert.equal(h.soundEffectsStore.getValue().enabled, false)
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'off')
		await h.selectSoundEffectPreset('balanced')
		assert.equal(h.soundEffectsStore.getValue().volumeBalance, false)
	},
)
await check(
	'custom preset preserves the edited band values and preset input cannot mutate stored arrays',
	async () => {
		const h = soundFixture()
		const gains = [1, 2, 3, 4, 5]
		await h.updateSoundEffects({ bands: gains, preset: 'custom' })
		gains[0] = 6
		assert.equal(h.soundEffectsStore.getValue().bands[0], 1)
		await h.selectSoundEffectPreset('custom')
		assert.deepEqual(plain(h.soundEffectsStore.getValue().bands), [1, 2, 3, 4, 5])
		assert.equal(h.soundEffectsStore.getValue().enabled, true)
		const beforeCalls = h.calls.length
		await assert.rejects(h.selectSoundEffectPreset('invalid'))
		assert.equal(h.calls.length, beforeCalls)
	},
)
await check(
	'unavailable native support reports unsupported only when an effect is requested',
	async () => {
		const h = soundFixture({ available: false })
		await h.initializeSoundEffects()
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'off')
		await h.selectSoundEffectPreset('bass')
		assert.deepEqual(plain(h.soundEffectsStatusStore.getValue()), {
			state: 'unsupported',
			reason: 'platform',
		})
		await h.resetSoundEffects()
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'off')
	},
)
await check(
	'current native waiting and unsupported states remain visible rather than claiming active',
	async () => {
		const h = soundFixture()
		h.configure(async (settings) => ({
			state: 'waiting',
			reason: 'stream',
			revision: settings.revision,
		}))
		await h.selectSoundEffectPreset('vocal')
		assert.deepEqual(plain(h.soundEffectsStatusStore.getValue()), {
			state: 'waiting',
			reason: 'stream',
		})
		h.emit({ state: 'unsupported', reason: 'format' })
		assert.deepEqual(plain(h.soundEffectsStatusStore.getValue()), {
			state: 'unsupported',
			reason: 'format',
		})
		h.emit({ state: 'active' })
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'active')
	},
)

await check(
	'idle playback never spins or times out; waiting expires and late PCM can recover',
	async () => {
		const h = soundFixture()
		h.configure(async (settings) => ({
			state: 'idle',
			reason: 'playback',
			revision: settings.revision,
		}))
		await h.selectSoundEffectPreset('bass')
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'idle')
		assert.equal(h.timers.size, 0)
		h.emit({ state: 'waiting', reason: 'processing' })
		assert.equal(h.timers.size, 1)
		h.runTimers()
		assert.deepEqual(plain(h.soundEffectsStatusStore.getValue()), {
			state: 'error',
			reason: 'timeout',
		})
		h.emit({ state: 'active' })
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'active')
		assert.equal(h.timers.size, 0)
	},
)

await check(
	'a hung configure expires, releases the apply queue and ignores stale callbacks',
	async () => {
		const h = soundFixture()
		const slow = deferred()
		h.configure(() => slow.promise)
		const operation = h.selectSoundEffectPreset('bass')
		const rejected = assert.rejects(operation, /timed out/)
		await flush()
		const oldRevision = h.calls[0].revision
		h.runTimers()
		await rejected
		assert.equal(h.soundEffectsStatusStore.getValue().reason, 'timeout')
		h.configure(async (settings) => ({ state: 'active', revision: settings.revision }))
		await h.updateSoundEffects({})
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'active')
		slow.resolve({ state: 'waiting', revision: oldRevision })
		h.emit({ state: 'waiting' }, oldRevision)
		await flush()
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'active')
		assert.equal(h.timers.size, 0)
	},
)

await check(
	'the native bridge loads the iOS module optionally and never requires it on other platforms',
	() => {
		let required = 0
		const native = { configure() {} }
		const bridge = (platform, value) =>
			loadModule('modules/cymusic-native/soundEffects.ts', {
				expo: {
					requireOptionalNativeModule: (name) => {
						assert.equal(name, 'CyMusicSoundEffects')
						required++
						return value
					},
				},
				'react-native': { Platform: { OS: platform } },
			}).default
		assert.equal(bridge('ios', native), native)
		assert.equal(bridge('ios', null), null)
		assert.equal(required, 2)
		assert.equal(bridge('android', native), null)
		assert.equal(required, 2)
	},
)

const findNodes = (node, predicate) => {
	if (!node || typeof node !== 'object') return []
	return [
		...(predicate(node) ? [node] : []),
		...(node.props?.children ?? []).flatMap((child) => findNodes(child, predicate)),
	]
}
await check(
	'sound effects screen controls call the real settings helper without coupling EQ and balance',
	async () => {
		const h = soundFixture()
		const { default: Screen } = loadModule(
			'src/app/(modals)/soundEffects.tsx',
			{
				'@expo/vector-icons': { Ionicons: 'Icon' },
				react,
				'react-native': {
					ActivityIndicator: 'Spinner',
					Pressable: 'Button',
					ScrollView: 'Scroll',
					StyleSheet: { create: (value) => value },
					Switch: 'Switch',
					Text: 'Text',
					View: 'View',
				},
				'react-native-awesome-slider': { Slider: 'Slider' },
				'react-native-reanimated': { useSharedValue: (value) => ({ value }) },
				'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
				'@/helpers/soundEffects': h,
				'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
				'@/utils/i18n': { t: (key) => key },
			},
			{ React: react },
		)
		let tree = Screen()
		findNodes(
			tree,
			(node) =>
				node.type === 'Switch' && node.props.accessibilityLabel === 'soundEffects.volumeBalance',
		)[0].props.onValueChange(true)
		await flush()
		assert.equal(h.soundEffectsStore.getValue().volumeBalance, true)
		assert.equal(h.soundEffectsStore.getValue().enabled, false)
		tree = Screen()
		findNodes(
			tree,
			(node) =>
				node.type === 'Button' &&
				findNodes(
					node,
					(child) =>
						child.type === 'Text' && child.props.children.includes('soundEffects.presets.bass'),
				).length,
		)[0].props.onPress()
		await flush()
		assert.equal(h.soundEffectsStore.getValue().preset, 'bass')
		assert.equal(h.soundEffectsStore.getValue().volumeBalance, true)
		tree = Screen()
		findNodes(
			tree,
			(node) =>
				node.type === 'Button' &&
				findNodes(
					node,
					(child) =>
						child.type === 'Text' && child.props.children.includes('soundEffects.resetAll'),
				).length,
		)[0].props.onPress()
		await flush()
		assert.equal(h.soundEffectsStore.getValue().enabled, false)
		assert.equal(h.soundEffectsStore.getValue().volumeBalance, false)
		h.emit({ state: 'idle', reason: 'playback' })
		assert.equal(findNodes(Screen(), (node) => node.type === 'Spinner').length, 0)
		h.emit({ state: 'waiting', reason: 'processing' })
		assert.equal(findNodes(Screen(), (node) => node.type === 'Spinner').length, 1)
		h.runTimers()
		tree = Screen()
		assert.equal(findNodes(tree, (node) => node.type === 'Spinner').length, 0)
		const retry = findNodes(
			tree,
			(node) =>
				node.type === 'Button' &&
				findNodes(
					node,
					(child) => child.type === 'Text' && child.props.children.includes('soundEffects.retry'),
				).length,
		)[0]
		assert.ok(retry)
		const before = h.calls.length
		retry.props.onPress()
		await flush()
		assert.equal(h.calls.length, before + 1)
		assert.equal(h.soundEffectsStatusStore.getValue().state, 'off')
	},
)
await check('player menu and settings both connect to the sound effects route', () => {
	for (const file of ['src/app/player.tsx', 'src/app/(modals)/settingModal.tsx']) {
		const source = fs.readFileSync(path.join(root, file), 'utf8')
		assert.match(source, /id:\s*['"]sound-effects['"]/)
		assert.match(source, /router\.push\(['"]\/\(modals\)\/soundEffects['"]\)/)
	}
	assert.ok(fs.existsSync(path.join(root, 'src/app/(modals)/soundEffects.tsx')))
})
finish()
