import { httpFetch } from '../../request'

const HOT_SEARCH_URL =
	'https://hotword.kuwo.cn/hotword.s?prod=kwplayer_ar_9.3.0.1&corp=kuwo&newver=2&vipver=9.3.0.1&source=kwplayer_ar_9.3.0.1_40.apk&p2p=1&notrace=0&uid=0&plat=kwplayer_ar&rformat=json&encoding=utf8&tabid=1'

export default {
	_requestObj: null,
	async getList() {
		this._requestObj?.cancelHttp()
		const requestObj = httpFetch(HOT_SEARCH_URL, {
			headers: {
				'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 9;)',
			},
		})
		this._requestObj = requestObj
		const { body, statusCode } = await requestObj.promise
		if (statusCode !== 200 || body.status !== 'ok' || !Array.isArray(body.tagvalue)) {
			throw new Error('Failed to load Kuwo trending searches')
		}
		return {
			source: 'kw',
			list: body.tagvalue.map((item) => item.key).filter(Boolean),
		}
	},
}
