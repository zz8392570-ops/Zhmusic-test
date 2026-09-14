import { decodeName } from '../../common'
import { httpFetch } from '../../request'

const HOT_SEARCH_URL =
	'https://gateway.kugou.com/api/v3/search/hot_tab?signature=ee44edb9d7155821412d220bcaf509dd&appid=1005&clientver=10026&plat=0'

export default {
	_requestObj: null,
	async getList() {
		this._requestObj?.cancelHttp()
		const requestObj = httpFetch(HOT_SEARCH_URL, {
			headers: {
				dfid: '1ssiv93oVqMp27cirf2CvoF1',
				mid: '156798703528610303473757548878786007104',
				clienttime: '1584257267',
				'x-router': 'msearch.kugou.com',
				'User-Agent': 'Android9-AndroidPhone-10020-130-0-searchrecommendprotocol-wifi',
				'kg-rc': '1',
			},
		})
		this._requestObj = requestObj
		const { body, statusCode } = await requestObj.promise
		if (statusCode !== 200 || body.errcode !== 0 || !Array.isArray(body.data?.list)) {
			throw new Error('Failed to load Kugou trending searches')
		}
		return {
			source: 'kg',
			list: body.data.list.flatMap((group) =>
				Array.isArray(group.keywords)
					? group.keywords.map((item) => decodeName(item.keyword)).filter(Boolean)
					: [],
			),
		}
	},
}
