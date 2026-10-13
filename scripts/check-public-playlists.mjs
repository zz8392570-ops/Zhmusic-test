import { assert, checks, loadModule } from './native-services-fixture.mjs'

const musicSdk = {
	tx: {
		songList: {
			getTags: async () => ({ hotTag: [{ id: 165, name: '流行' }] }),
			getList: async () => ({
				list: [{ id: 11, name: 'QQ 热门', img: 'http://img/qq.jpg', playCount: 120000 }],
				limit: 30,
				total: 1,
			}),
		},
	},
}

const response = (value) => ({
	ok: true,
	text: async () => (typeof value === 'string' ? value : JSON.stringify(value)),
})

const fetch = async (url) => {
	const href = String(url)
	if (href.includes('music.163.com/api/playlist/list')) {
		return response({
			playlists: [
				{ id: 22, name: '网易热门', coverImgUrl: 'http://img/wy.jpg', playCount: 230000 },
				{ id: 22, name: '重复项', coverImgUrl: 'http://img/duplicate.jpg' },
			],
			total: 2,
			more: false,
		})
	}
	if (href.includes('getRcmPlayList')) {
		return response({
			data: { data: [{ id: 33, name: '酷我热门', img: 'http://img/kw.jpg' }], total: 1, rn: 30 },
		})
	}
	if (href.includes('m.kugou.com/plist/index')) {
		return response({
			plist: {
				list: {
					info: [{ specialid: 44, specialname: '酷狗热门', imgurl: 'http://img/kg.jpg' }],
					total: 1,
				},
			},
		})
	}
	if (href.includes('playlist-square-recommend')) {
		return response({
			data: {
				contents: [
					{ resType: '2021', resId: 55, title: '咪咕热门', imageUrl: 'http://img/mg.jpg' },
				],
			},
		})
	}
	throw new Error(`Unexpected URL: ${href}`)
}

const helper = loadModule(
	'src/helpers/publicPlaylists.ts',
	{
		'@/components/utils/musicSdk': { __esModule: true, default: musicSdk },
		'@/constants/images': { unknownTrackImageUri: 'fallback' },
		'@/helpers/artworkResolver': {
			normalizeArtworkUrl: (url) => String(url).replace(/^http:/, 'https:'),
		},
	},
	{ fetch, URLSearchParams },
)

const suite = checks()

await suite.check('returns platform categories with recommendation first', async () => {
	const categories = await helper.getPublicPlaylistCategories('tx')
	assert.equal(categories.map((item) => item.name).join(','), '推荐,流行')
})

await suite.check('normalizes public playlists from all supported platforms', async () => {
	const sources = ['tx', 'wy', 'kw', 'kg', 'mg']
	const pages = await Promise.all(sources.map((source) => helper.getPublicPlaylists(source)))
	assert.equal(pages.map((page) => page.list[0]?.id).join(','), '11,22,33,44,55')
	assert.equal(pages[1].list.length, 1)
	assert.equal(pages[0].list[0].playCount, '12万')
	assert.equal(pages[2].list[0].artwork, 'https://img/kw.jpg')
})

suite.finish()
