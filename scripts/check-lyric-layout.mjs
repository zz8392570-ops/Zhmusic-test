import { assert, checks, loadModule } from './native-services-fixture.mjs'

const { check, finish } = checks()
const helpers = loadModule('src/helpers/lyricLayout.ts', {})
await check('variable-height lyrics preserve offsets after earlier rows are remeasured', () => {
	const layout = helpers.createLyricLayout(1000, 92)
	layout.setHeaderHeight(180)
	assert.equal(layout.getItemLayout(null, 999).offset, 180 + 999 * 92)
	layout.setHeight(0, 140)
	layout.setHeight(100, 200)
	assert.equal(layout.getItemLayout(null, 999).offset, 180 + 999 * 92 + 48 + 108)
	layout.setHeight(0, 80)
	assert.equal(layout.getItemLayout(null, 999).offset, 180 + 999 * 92 - 12 + 108)
	layout.setHeaderHeight(250)
	assert.equal(layout.getItemLayout(null, 0).offset, 250)
})
await check('drag lookup agrees with row offsets including unmeasured lines and boundaries', () => {
	const layout = helpers.createLyricLayout(1000, 92)
	layout.setHeaderHeight(180)
	for (let index = 0; index < 1000; index += 7) layout.setHeight(index, 40 + (index % 150))
	for (let index = 0; index < 1000; index++) {
		const row = layout.getItemLayout(null, index)
		assert.equal(layout.indexAt(row.offset), index)
		assert.equal(layout.indexAt(row.offset + row.length - 0.01), index)
	}
	assert.equal(layout.indexAt(-100), 0)
	assert.equal(layout.indexAt(Infinity), 999)
})

// Execute the component's hooks and handlers; native list measurement remains a device check.
function fixture() {
	let slots = [],
		cursor = 0,
		pending = []
	const timers = new Map()
	let nextTimer = 0
	const dependenciesChanged = (before, after) =>
		!before || after.some((x, i) => !Object.is(x, before[i]))
	const react = {
		createElement(type, props, ...children) {
			return { type, props: { ...props, children } }
		},
		useRef(value) {
			return (slots[cursor++] ??= { current: value })
		},
		useMemo(make, deps) {
			const index = cursor++
			if (dependenciesChanged(slots[index]?.deps, deps)) slots[index] = { value: make(), deps }
			return slots[index].value
		},
		useCallback(fn, deps) {
			return react.useMemo(() => fn, deps)
		},
		useEffect(effect, deps) {
			const index = cursor++
			if (dependenciesChanged(slots[index]?.deps, deps))
				pending.push(() => {
					slots[index]?.cleanup?.()
					slots[index] = { deps, cleanup: effect() }
				})
		},
	}
	const colors = {}
	const dimensions = { width: 390, fontScale: 1 }
	let lyrics = [
			{ lrc: 'First', time: 0 },
			{ lrc: 'Second', time: 5 },
		],
		fontSize = 1
	const lyricState = () => ({ loading: false, lyrics, meta: {} })
	const reset = () => {}
	const component = loadModule(
		'src/components/lyric/index.tsx',
		{
			react,
			'react-native': {
				View: 'View',
				Text: 'Text',
				StyleSheet: { create: (x) => x },
				useWindowDimensions: () => dimensions,
			},
			'react-native-gesture-handler': { FlatList: 'List' },
			'@/helpers/lyricManager': {
				useLyricState: lyricState,
				getLyricState: lyricState,
				useCurrentLyric: () => ({ index: 1 }),
				getCurrentLyric: () => ({ index: 1 }),
			},
			'@/helpers/trackPlayerIndex': {},
			'@/hooks/useAppTheme': { useThemeColors: () => colors },
			'@/hooks/useDelayFalsy': () => [undefined, reset, reset],
			'@/store/PersistStatus': { useValue: () => fontSize },
			'@/helpers/lyricLayout': helpers,
			'@/utils/trackUtils': { musicIsPaused: () => true },
			'@rntp/player': { useIsPlaying: () => false },
			'../../utils/rpx': (x) => x,
			'./lyricItem': 'Row',
			'@/utils/i18n': { t: (x) => x },
		},
		{
			setTimeout: (fn) => {
				timers.set(++nextTimer, fn)
				return nextTimer
			},
			clearTimeout: (id) => timers.delete(id),
		},
	)
	const find = (tree, type) =>
		tree?.type === type
			? tree
			: tree?.props?.children?.flatMap((child) => [find(child, type)]).find(Boolean)
	return {
		timers,
		dimensions,
		changeLyrics() {
			lyrics = lyrics.map((line) => ({ ...line, lrc: 'New ' + line.lrc }))
		},
		changeFont() {
			fontSize++
		},
		render() {
			cursor = 0
			const list = find(component.default(), 'List')
			for (const commit of pending) commit()
			pending = []
			return list.props
		},
		unmount() {
			for (const slot of slots) slot?.cleanup?.()
		},
	}
}
await check(
	'song, font and width changes reset list frames and isolate late old measurements',
	() => {
		const f = fixture()
		let previous = f.render()
		previous.renderItem({ item: {}, index: 0 }).props.onLayout(0, 300)
		assert.equal(previous.getItemLayout(null, 1).offset, 300)
		assert.equal(f.render().key, previous.key)
		for (const change of [
			() => f.changeLyrics(),
			() => f.changeFont(),
			() => {
				f.dimensions.width = 600
			},
			() => {
				f.dimensions.fontScale = 1.5
			},
		]) {
			change()
			const current = f.render()
			assert.notEqual(current.key, previous.key)
			previous.renderItem({ item: {}, index: 0 }).props.onLayout(0, 999)
			assert.equal(current.getItemLayout(null, 1).offset, 92)
			previous = current
		}
		f.unmount()
	},
)
await check('layout changes and unmount retire delayed scroll retries', () => {
	const f = fixture()
	let list = f.render()
	list.onScrollToIndexFailed({ index: 1 })
	list.onScrollToIndexFailed({ index: 1 })
	assert.equal(f.timers.size, 1)
	f.changeLyrics()
	list = f.render()
	assert.equal(f.timers.size, 0)
	list.onScrollToIndexFailed({ index: 1 })
	f.unmount()
	assert.equal(f.timers.size, 0)
})
finish()
