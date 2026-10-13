import { assert, checks, deferred, flush, loadModule } from './native-services-fixture.mjs'

let requests = 0
const helper = loadModule('src/helpers/hotSearch.ts', {
	'@/components/utils/musicSdk': {
		tx: {
			hotSearch: {
				getList: async () => {
					requests += 1
					return {
						list: ['same', 'QQ'],
						items: [
							{ keyword: 'same', score: '1478304' },
							{ keyword: 'QQ', score: null },
						],
					}
				},
			},
		},
		wy: {
			hotSearch: {
				getList: async () => ({
					items: [
						{ keyword: 'same', score: 106538 },
						{ keyword: 'WY', score: 55582 },
					],
				}),
			},
		},
		kg: { hotSearch: { getList: async () => ({ list: ['KG'] }) } },
	},
	'@/helpers/crossPlatformSearch': { MUSIC_PLATFORMS: ['tx', 'wy', 'kg'] },
})
const suite = checks()
await suite.check(
	'keeps real heat, rejects missing or invalid heat without inventing values',
	() => {
		const items = helper.normalizeHotSearchItems(
			[
				{ keyword: ' one ', score: '12345' },
				{ keyword: 'two', score: -1 },
				{ keyword: 'three', score: 'bad' },
				'four',
				{ keyword: '' },
				{ keyword: 'one', score: 999 },
			],
			'tx',
		)
		assert.equal(items.length, 4)
		assert.equal(items[0].score, 12345)
		assert.equal(items[1].score, undefined)
		assert.equal(items[2].score, undefined)
		assert.equal(items[3].score, undefined)
		assert.equal(helper.formatHotSearchScore(items[0].score), '1.2万')
		assert.equal(helper.formatHotSearchScore(undefined), '')
	},
)
await suite.check(
	'all-platform results preserve score provenance and never add different platform scores',
	async () => {
		const items = await helper.getHotSearchItems('all')
		const duplicate = items.filter((item) => item.keyword === 'same')
		assert.equal(duplicate.length, 1)
		assert.equal(duplicate[0].score, 1478304)
		assert.equal(duplicate[0].platform, 'tx')
		assert.equal(items.find((item) => item.keyword === 'KG').score, undefined)
	},
)
await suite.check('keyword compatibility and forced refresh remain usable', async () => {
	const before = requests
	assert.equal((await helper.getHotSearches('tx')).join(','), 'same,QQ')
	assert.equal(requests, before)
	await helper.getHotSearchItems('tx', true)
	assert.equal(requests, before + 1)
})
await suite.check('retains only provider badges and never invents a trend status', () => {
	const items = helper.normalizeHotSearchItems(
		[
			{ keyword: 'badge', score: 500, badgeUrl: 'http://example.com/hot.png' },
			{ keyword: 'text', badgeText: ' 新 ' },
			{ keyword: 'plain', badgeUrl: 'javascript:alert(1)', badgeText: '' },
		],
		'wy',
	)
	assert.equal(items[0].badgeUrl, 'https://example.com/hot.png')
	assert.equal(items[1].badgeText, '新')
	assert.equal(items[2].badgeUrl, undefined)
	assert.equal(items[2].badgeText, undefined)
})
const cacheHarness = () => {
	let now = 1000
	let txResponse = async () => ({ items: [{ keyword: 'old', score: 10 }] })
	let wyResponse = async () => ({ items: [{ keyword: 'wy', score: 20 }] })
	const calls = { tx: 0, wy: 0 }
	const module = loadModule(
		'src/helpers/hotSearch.ts',
		{
			'@/components/utils/musicSdk': {
				tx: {
					hotSearch: {
						getList: () => {
							calls.tx++
							return txResponse()
						},
					},
				},
				wy: {
					hotSearch: {
						getList: () => {
							calls.wy++
							return wyResponse()
						},
					},
				},
			},
			'@/helpers/crossPlatformSearch': { MUSIC_PLATFORMS: ['tx', 'wy'] },
		},
		{ Date: { now: () => now } },
	)
	return {
		module,
		calls,
		advance: (time) => {
			now += time
		},
		tx: (fn) => {
			txResponse = fn
		},
		wy: (fn) => {
			wyResponse = fn
		},
	}
}
await suite.check('cached heat expires and refreshes after five minutes', async () => {
	const h = cacheHarness()
	await h.module.getHotSearchItems('tx')
	h.advance(h.module.HOT_SEARCH_TTL_MS - 1)
	await h.module.getHotSearchItems('tx')
	assert.equal(h.calls.tx, 1)
	h.tx(async () => ({ items: [{ keyword: 'new', score: 99 }] }))
	h.advance(1)
	assert.equal((await h.module.getHotSearchItems('tx'))[0].score, 99)
	assert.equal(h.calls.tx, 2)
})
await suite.check(
	'overlapping manual and all-platform refreshes share one provider request',
	async () => {
		const h = cacheHarness()
		const slow = deferred()
		h.tx(() => slow.promise)
		const all = h.module.getHotSearchItems('all', true)
		const single = h.module.getHotSearchItems('tx', true)
		await flush()
		assert.equal(h.calls.tx, 1)
		slow.resolve({ items: [{ keyword: 'same snapshot', score: 30 }] })
		assert.equal((await single)[0].score, 30)
		assert.equal((await all).find((item) => item.platform === 'tx').score, 30)
	},
)
await suite.check(
	'refreshing one platform immediately updates subsequent all-platform results',
	async () => {
		const h = cacheHarness()
		await h.module.getHotSearchItems('all')
		h.tx(async () => ({ items: [{ keyword: 'fresh', score: 120 }] }))
		await h.module.getHotSearchItems('tx', true)
		const all = await h.module.getHotSearchItems('all')
		assert.equal(all.find((item) => item.platform === 'tx').keyword, 'fresh')
		assert.equal(h.calls.tx, 2)
		assert.equal(h.calls.wy, 1)
	},
)
await suite.check(
	'failed refresh retains older data with explicit stale provider metadata',
	async () => {
		const h = cacheHarness()
		await h.module.getHotSearchItems('tx')
		h.tx(async () => {
			throw new Error('offline')
		})
		const snapshot = await h.module.getHotSearchSnapshot('tx', true)
		assert.equal(snapshot.items[0].keyword, 'old')
		assert.equal(snapshot.stalePlatforms.join(','), 'tx')
		h.tx(async () => ({ items: [{ keyword: 'recovered', score: 33 }] }))
		assert.equal((await h.module.getHotSearchSnapshot('tx', true)).stalePlatforms.length, 0)
	},
)
await suite.check(
	'partial failure preserves usable providers and total uncached failure rejects',
	async () => {
		const h = cacheHarness()
		h.wy(async () => {
			throw new Error('offline')
		})
		const snapshot = await h.module.getHotSearchSnapshot('all')
		assert.equal(snapshot.items.length, 1)
		assert.equal(snapshot.stalePlatforms.join(','), 'wy')
		h.tx(async () => {
			throw new Error('offline')
		})
		const uncached = cacheHarness()
		uncached.tx(async () => {
			throw new Error('offline')
		})
		uncached.wy(async () => {
			throw new Error('offline')
		})
		await assert.rejects(uncached.module.getHotSearchSnapshot('all'))
	},
)
await suite.check(
	'a slow aggregate cannot return superseded data from a fast provider',
	async () => {
		const h = cacheHarness()
		const slow = deferred()
		h.tx(() => slow.promise)
		const all = h.module.getHotSearchSnapshot('all', true)
		await flush()
		h.wy(async () => ({ items: [{ keyword: 'newest wy', score: 200 }] }))
		await h.module.getHotSearchSnapshot('wy', true)
		slow.resolve({ items: [{ keyword: 'tx', score: 1 }] })
		const snapshot = await all
		assert.equal(snapshot.items.find((item) => item.platform === 'wy').score, 200)
	},
)
const react = {
	useMemo: (fn) => fn(),
	createElement: (type, props, ...children) => ({
		type,
		props: { ...props, children: children.flat() },
	}),
}
const { default: SearchDiscovery } = loadModule(
	'src/components/search/SearchDiscovery.tsx',
	{
		'@/helpers/hotSearch': helper,
		'@/helpers/musicPlatform': { getMusicPlatformLabelKey: () => 'platform' },
		'@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
		'react-native': {
			ActivityIndicator: 'Loading',
			Pressable: 'Button',
			ScrollView: 'Scroll',
			StyleSheet: { create: (value) => value },
			Text: 'Text',
			View: 'View',
		},
		'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
		'@/utils/haptics': { hapticSelection() {} },
		'@/utils/i18n': { t: (key) => key },
		react,
		'expo-image': { Image: 'Image' },
	},
	{ React: react },
)
const nodes = (node, predicate) => {
	if (!node || typeof node !== 'object') return []
	return [
		...(predicate(node) ? [node] : []),
		...(node.props?.children ?? []).flatMap((child) => nodes(child, predicate)),
	]
}
await suite.check(
	'discovery keeps cached songs actionable during refresh and failures, with separate refresh and batch controls',
	() => {
		let refreshed = 0
		let changed = 0
		let searched = ''
		const props = {
			history: [],
			hotSearches: [{ keyword: 'cached song', platform: 'tx', score: 100 }],
			hotSearchTitle: 'Hot',
			hotRankOffset: 0,
			canChangeHotSearch: true,
			isHotLoading: false,
			hasHotError: true,
			hasPartialHotError: true,
			onSearch: (keyword) => {
				searched = keyword
			},
			onClearHistory() {},
			onRemoveHistory() {},
			onRetryHotSearch: () => {
				refreshed++
			},
			onChangeHotSearch: () => {
				changed++
			},
		}
		const tree = SearchDiscovery(props)
		const buttons = nodes(tree, (node) => node.type === 'Button')
		buttons
			.find((node) => node.props.accessibilityLabel === 'find.refreshHotSearch')
			.props.onPress()
		buttons.find((node) => node.props.accessibilityLabel === 'find.changeBatch').props.onPress()
		assert.equal(refreshed, 1)
		assert.equal(changed, 1)
		assert.equal(
			nodes(
				tree,
				(node) => node.type === 'Text' && node.props.children.includes('find.hotSearchPartial'),
			).length,
			1,
		)
		const loading = SearchDiscovery({ ...props, isHotLoading: true })
		nodes(loading, (node) => node.type === 'Button')
			.find(
				(node) =>
					nodes(
						node,
						(child) => child.type === 'Text' && child.props.children.includes('cached song'),
					).length,
			)
			.props.onPress()
		assert.equal(searched, 'cached song')
	},
)
suite.finish()
