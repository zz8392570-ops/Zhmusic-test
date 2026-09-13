import { Buffer } from 'buffer'
import { aesDecryptSync, aesEncryptSync, AES_MODE } from '@/components/utils/nativeModules/crypto'
import { toMD5 } from '../utils'

export const formatSinger = (rawData) => rawData.replace(/&/g, '、')

export const wbdCrypto = {
  aesMode: 'aes-128-ecb',
  aesKey: 'cFcnPcf6Kb85RC1y3V6M5A==',
  aesIv: '',
  appId: 'y67sprxhhpws',
  decodeData(base64Result) {
    const data = decodeURIComponent(base64Result)
    return JSON.parse(aesDecryptSync(data, this.aesKey, this.aesIv, AES_MODE.ECB_128_NoPadding))
  },
  createSign(data, time) {
    const str = `${this.appId}${data}${time}`
    return toMD5(str).toUpperCase()
  },
  buildParam(jsonData) {
    const data = Buffer.from(JSON.stringify(jsonData)).toString('base64')
    const time = Date.now()
    const encodeData = aesEncryptSync(data, this.aesKey, this.aesIv, AES_MODE.ECB_128_NoPadding)
    const sign = this.createSign(encodeData, time)
    return `data=${encodeURIComponent(encodeData)}&time=${time}&appId=${this.appId}&sign=${sign}`
  },
}
