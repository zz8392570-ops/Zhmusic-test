import { httpFetch } from '../../request'

// Migu's legacy hotword service is HTTP-only. Use its current hot-song chart so
// the discovery terms remain platform-specific without weakening transport security.
const HOT_CHART_URL =
	'https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/querycontentbyId.do?columnId=27186466&needAll=0'

export default {
	_requestObj: null,
	async getList() {
		this._requestObj?.cancelHttp()
		const requestObj = httpFetch(HOT_CHART_URL, {
			headers: {
				Referer: 'https://app.c.nf.migu.cn/',
				channel: '0146921',
			},
		})
		this._requestObj = requestObj
		const { body, statusCode } = await requestObj.promise
		const contents = body.columnInfo?.contents
		if (statusCode !== 200 || body.code !== '000000' || !Array.isArray(contents)) {
			throw new Error('Failed to load Migu trending searches')
		}
		return {
			source: 'mg',
			list: contents.map((item) => item.objectInfo?.songName).filter(Boolean),
		}
	},
}
