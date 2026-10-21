import { assert, checks, deferred, flush, loadModule } from './native-services-fixture.mjs'
const { check, finish } = checks()
const state = (value) => ({
	getValue: () => value,
	useValue: () => value,
	setValue: (next) => {
		value = next
	},
})
const api = (id, status = 'normal') => ({ id, name: id, health: { status } })
function sourceFixture({ test = async () => {}, select } = {}) {
	const sources = state([api('one'), api('two')]),
		selected = state(api('previous')),
		calls = []
	const helper = loadModule('src/helpers/userApi/sourceSetup.ts', {
		'@/player/PlayerStore': { musicApiStore: sources, musicApiSelectedStore: selected },
		'./musicApiControl': {
			testMusicApiById: async (id) => {
				calls.push(['test', id])
				await test(id)
			},
			setMusicApiAsSelectedById: async (id, options) => {
				calls.push(['select', id, options])
				if (select) return select(id, options)
				const next = sources.getValue().find((item) => item.id === id)
				selected.setValue(next)
				return next
			},
		},
	})
	return { sources, selected, calls, helper }
}
await check('setup tests before selecting and accepts normal or partial health only', async () => {
	for (const status of ['normal', 'partial', 'dead', 'idle', 'testing']) {
		const h = sourceFixture()
		h.sources.setValue([api('one', status)])
		const result = await h.helper.testAndSelectSource('one', new AbortController().signal)
		assert.equal(result, ['normal', 'partial'].includes(status))
		assert.equal(h.calls[0][0], 'test')
		assert.equal(h.calls.length, result ? 2 : 1)
		assert.equal(h.selected.getValue().id, result ? 'one' : 'previous')
	}
})
await check('cancelled, missing or failed selections cannot become ready', async () => {
	const gate = deferred(),
		h = sourceFixture({ test: () => gate.promise }),
		controller = new AbortController()
	const pending = h.helper.testAndSelectSource('one', controller.signal)
	controller.abort()
	gate.resolve()
	assert.equal(await pending, false)
	assert.equal(h.calls.length, 1)
	const missing = sourceFixture()
	missing.sources.setValue([])
	assert.equal(await missing.helper.testAndSelectSource('one', new AbortController().signal), false)
	const failed = sourceFixture({ select: async () => undefined })
	assert.equal(await failed.helper.testAndSelectSource('one', new AbortController().signal), false)
	const removed = sourceFixture({ test: async () => removed.sources.setValue([]) })
	assert.equal(await removed.helper.testAndSelectSource('one', new AbortController().signal), false)
})
function screenFixture(options = {}) {
	let cursor = 0,
		tree
	const slots = [],
		cleanups = [],
		writes = [],
		navigation = [],
		imports = []
	const react = {
		createElement: (type, props, ...children) => ({
			type,
			props: { ...props, children: children.flat().filter(Boolean) },
		}),
		useState(initial) {
			const index = cursor++
			if (!(index in slots)) slots[index] = initial
			return [
				slots[index],
				(next) => {
					slots[index] = typeof next === 'function' ? next(slots[index]) : next
				},
			]
		},
		useRef(initial) {
			const index = cursor++
			return (slots[index] ??= { current: initial })
		},
		useEffect(effect) {
			const index = cursor++
			if (!(index in slots)) {
				slots[index] = true
				cleanups.push(effect())
			}
		},
	}
	const h = sourceFixture(options),
		progress = state(null)
	const Screen = loadModule(
		'src/app/(modals)/sourceSetup.tsx',
		{
			react,
			'react-native': {
				ActivityIndicator: 'Spinner',
				Pressable: 'Pressable',
				ScrollView: 'ScrollView',
				Text: 'Text',
			},
			'expo-router': { router: { dismissTo: (path) => navigation.push(path) } },
			'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
			'@/components/LibraryToolButton': { LibraryToolButton: 'Button' },
			'@/helpers/trackPlayerIndex': { musicApiStore: h.sources, musicApiSelectedStore: h.selected },
			'@/helpers/userApi/sourceImportActions': {
				sourceFileImportProgress: progress,
				importMusicSourceFromFile: () => imports.push('file'),
				importMusicSourceFromUrl: () => imports.push('url'),
			},
			'@/helpers/userApi/sourceSetup': h.helper,
			'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
			'@/store/PersistStatus': { set: (...args) => writes.push(args) },
			'@/utils/i18n': { t: (key) => key },
		},
		{ React: react },
	).default
	const nodes = (node) =>
		!node || typeof node !== 'object' ? [] : [node, ...(node.props?.children ?? []).flatMap(nodes)]
	const render = () => {
		cursor = 0
		tree = Screen()
	}
	render()
	return {
		...h,
		progress,
		navigation,
		writes,
		imports,
		render,
		button: (title) => {
			const node = nodes(tree).find((node) => node.type === 'Button' && node.props.title === title)
			assert.ok(node, title)
			return node.props
		},
		choose: (id) => {
			nodes(tree)
				.find((node) => node.props.accessibilityRole === 'radio' && node.props.key === id)
				.props.onPress()
			render()
		},
		hasText: (text) =>
			nodes(tree).some((node) => node.type === 'Text' && node.props.children.includes(text)),
		unmount: () => cleanups.forEach((cleanup) => cleanup?.()),
	}
}
await check(
	'real setup screen connects imports, test-and-use, then search without duplicate tests',
	async () => {
		const gate = deferred(),
			h = screenFixture({ test: () => gate.promise })
		assert.equal(h.button('sourceSetup.search').disabled, true)
		h.button('settings.actions.import.fromFile').onPress()
		h.button('settings.actions.import.fromUrl').onPress()
		assert.deepEqual(h.imports, ['file', 'url'])
		const test = h.button('sourceSetup.testAndUse').onPress
		test()
		test()
		h.render()
		assert.equal(h.calls.length, 1)
		assert.equal(h.button('sourceSetup.search').disabled, true)
		assert.equal(h.button('settings.actions.import.fromFile').disabled, true)
		gate.resolve()
		await flush()
		h.render()
		assert.equal(h.button('sourceSetup.search').disabled, false)
		h.choose('two')
		assert.equal(h.button('sourceSetup.search').disabled, true)
		h.button('sourceSetup.testAndUse').onPress()
		await flush()
		h.render()
		h.button('sourceSetup.search').onPress()
		assert.deepEqual(h.navigation, ['/(tabs)/search'])
		assert.deepEqual(h.writes, [['app.onboardingCompleted', true]])
	},
)
await check(
	'real setup screen handles missing sources, failed tests, retry, local import and unmount',
	async () => {
		const h = screenFixture()
		h.sources.setValue([])
		h.render()
		assert.equal(h.button('sourceSetup.testAndUse').disabled, true)
		h.button('sourceSetup.local').onPress()
		assert.deepEqual(h.navigation, ['/(tabs)/favorites/localMusic'])
		h.sources.setValue([api('one', 'dead')])
		h.render()
		h.button('sourceSetup.testAndUse').onPress()
		await flush()
		h.render()
		assert.equal(h.hasText('sourceSetup.failed'), true)
		assert.equal(h.button('sourceSetup.search').disabled, true)
		h.sources.setValue([api('one')])
		h.button('sourceSetup.testAndUse').onPress()
		await flush()
		h.render()
		assert.equal(h.button('sourceSetup.search').disabled, false)
		h.progress.setValue({ completed: 0, total: 1 })
		h.render()
		assert.equal(h.button('sourceSetup.search').disabled, true)
		const gate = deferred(),
			late = screenFixture({ test: () => gate.promise })
		late.button('sourceSetup.testAndUse').onPress()
		late.unmount()
		gate.resolve()
		await flush()
		assert.equal(late.calls.length, 1)
		assert.deepEqual(late.navigation, [])
	},
)
await check('URL imports share the file-import lock and always release busy progress', async () => {
	const alerts = [],
		prompts = [],
		selections = [],
		gate = deferred()
	let fail = false
	class GlobalState {
		constructor(value) {
			this.value = value
		}
		setValue(value) {
			this.value = value
		}
		getValue() {
			return this.value
		}
	}
	const owner = loadModule('src/helpers/userApi/sourceImportActions.ts', {
		'react-native': {
			Alert: { alert: (...args) => alerts.push(args), prompt: (...args) => prompts.push(args) },
		},
		'expo-document-picker': {
			getDocumentAsync: async () => {
				selections.push('file')
				return { canceled: true }
			},
		},
		'expo-file-system': {},
		'@/helpers/logger': { logError() {}, logInfo() {} },
		'@/utils/stateMapper': { GlobalState },
		'@/utils/i18n': { t: (key) => key },
		'./importMusicSource': { fetchScriptFromUrl: () => 'script' },
		'./musicApiControl': {},
		'./batchMusicSourceImport': {
			importMusicSourceFiles: async (files) => {
				assert.equal(await files[0].read(), 'script')
				if (fail) throw new Error('Fixture URL failure')
				return gate.promise
			},
		},
	})
	await owner.importMusicSourceFromUrl()
	const confirm = prompts[0][2][1].onPress
	const pending = confirm('https://source.test/source.js')
	await flush()
	assert.ok(owner.sourceFileImportProgress.getValue())
	await owner.importMusicSourceFromFile()
	assert.deepEqual(selections, [])
	gate.resolve({ failures: [], restoreFailed: false })
	await pending
	assert.equal(owner.sourceFileImportProgress.getValue(), null)
	await owner.importMusicSourceFromFile()
	assert.deepEqual(selections, ['file'])
	fail = true
	await owner.importMusicSourceFromUrl()
	await prompts.at(-1)[2][1].onPress('https://source.test/bad.js')
	assert.equal(alerts.at(-1)[1], 'sourceImport.failed')
	assert.equal(owner.sourceFileImportProgress.getValue(), null)
	await owner.importMusicSourceFromUrl()
	await prompts.at(-1)[2][1].onPress('')
	assert.equal(alerts.at(-1)[1], 'sourceImport.urlEmpty')
})
finish()
