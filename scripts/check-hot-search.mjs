import { assert, checks, loadModule } from './native-services-fixture.mjs'

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
suite.finish()
