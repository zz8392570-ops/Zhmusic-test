import AES from 'crypto-js/aes'
import Hex from 'crypto-js/enc-hex'
import Utf8 from 'crypto-js/enc-utf8'
import MD5 from 'crypto-js/md5'
import ECB from 'crypto-js/mode-ecb'
import Pkcs7 from 'crypto-js/pad-pkcs7'

import { httpFetch } from '../../request'

const API_PATH = '/api/search/chart/detail'
const EAPI_KEY = 'e82ckenh8dichen8'

const createEapiParams = (data) => {
	const text = JSON.stringify(data)
	const digest = MD5(`nobody${API_PATH}use${text}md5forencrypt`).toString()
	const payload = `${API_PATH}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
	return AES.encrypt(payload, Utf8.parse(EAPI_KEY), {
		mode: ECB,
		padding: Pkcs7,
	})
		.ciphertext.toString(Hex)
		.toUpperCase()
}

export default {
	_requestObj: null,
	async getList() {
		this._requestObj?.cancelHttp()
		const requestObj = httpFetch(`https://interface.music.163.com/eapi${API_PATH}`, {
			method: 'post',
			form: {
				params: createEapiParams({ id: 'HOT_SEARCH_SONG#@#' }),
			},
			headers: {
				Origin: 'https://music.163.com',
				Referer: 'https://music.163.com/',
			},
		})
		this._requestObj = requestObj
		const { body, statusCode } = await requestObj.promise
		if (statusCode !== 200 || body.code !== 200 || !Array.isArray(body.data?.itemList)) {
			throw new Error('Failed to load NetEase trending searches')
		}
		return {
			source: 'wy',
			list: body.data.itemList.map((item) => item.searchWord).filter(Boolean),
		}
	},
}
