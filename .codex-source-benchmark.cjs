const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const dns = require('node:dns').promises
const net = require('node:net')

process.on('unhandledRejection', () => {})

const sourceDir = process.argv[2]
const mode = process.argv[3] || 'baseline'
const selectedNames = new Set((process.argv[4] || '').split('|').filter(Boolean))
if (!sourceDir) throw new Error('source directory is required')

const EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' }
const MAX_SCRIPT_REQUESTS = 80
const INIT_TIMEOUT_MS = 10_000
const RESOLVE_TIMEOUT_MS = 12_000
const PROBE_TIMEOUT_MS = 8_000
const hostSafetyCache = new Map()

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms)),
])

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase()
    return value === '::1' || value === '::' || value.startsWith('fc') ||
      value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') ||
      value.startsWith('fea') || value.startsWith('feb')
  }
  return true
}

async function assertPublicUrl(rawUrl) {
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported URL protocol')
  if (url.username || url.password) throw new Error('credentials in URL are not allowed')
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local')) throw new Error('local URL blocked')
  if (hostSafetyCache.has(host)) {
    if (!hostSafetyCache.get(host)) throw new Error('private network URL blocked')
    return url
  }
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true })
  const safe = addresses.length > 0 && addresses.every(item => !isPrivateIp(item.address))
  hostSafetyCache.set(host, safe)
  if (!safe) throw new Error('private network URL blocked')
  return url
}

async function fetchWithTimeout(rawUrl, options = {}, timeoutMs = 10_000) {
  await assertPublicUrl(rawUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(rawUrl, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options, 12_000)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return JSON.parse(await response.text())
}

const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s·•・._'’"()（）-]+/g, '')

function pickSong(items, title) {
  const target = normalize(title)
  return items.find(item => normalize(item.title || item.name || item.SONGNAME || item.SongName || item.OriSongName) === target &&
    normalize(item.artist || item.singer || item.ARTIST || item.SingerName).includes('周杰伦')) || items[0]
}

async function searchTracks() {
  const titles = ['稻香', '晴天']
  const txIds = { 稻香: '004IArbh3ytHgR', 晴天: '003OUlho2HcRHC' }
  const output = { tx: [], kw: [], kg: [], wy: [], mg: [] }

  for (const title of titles) {
    output.tx.push({
      platform: 'tx', id: txIds[title], songmid: txIds[title], title, name: title,
      artist: '周杰伦', singer: '周杰伦', album: '', albumName: '', hash: txIds[title],
      qualities: {}, _types: {}, typeUrl: {},
    })

    try {
      const kw = await fetchJson(`https://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(`${title} 周杰伦`)}&pn=0&rn=10&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`)
      const item = pickSong(kw.abslist || [], title)
      if (item) {
        const id = String(item.MUSICRID || item.DC_TARGETID || '').replace('MUSIC_', '')
        output.kw.push({ platform: 'kw', id, songmid: id, hash: id, title, name: title, artist: item.ARTIST || '周杰伦', singer: item.ARTIST || '周杰伦', album: item.ALBUM || '', albumName: item.ALBUM || '', qualities: {}, _types: {}, typeUrl: {} })
      }
    } catch (error) { console.log(`SEARCH kw ${title}: ${error.message}`) }

    try {
      const kg = await fetchJson(`https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(`${title} 周杰伦`)}&page=1&pagesize=10&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`)
      const items = (kg.data?.lists || []).flatMap(item => [item, ...(item.Grp || [])])
      const item = pickSong(items, title)
      if (item) {
        const hash = String(item.FileHash || '')
        const id = String(item.Audioid || item.MixSongID || hash)
        const qualities = {
          '128k': { hash, size: item.FileSize },
          '320k': { hash: item.HQFileHash, size: item.HQFileSize },
          flac: { hash: item.SQFileHash, size: item.SQFileSize },
        }
        output.kg.push({ platform: 'kg', id, songmid: id, hash, title, name: title, artist: item.SingerName || '周杰伦', singer: item.SingerName || '周杰伦', album: item.AlbumName || '', albumName: item.AlbumName || '', qualities, _types: qualities, typeUrl: {} })
      }
    } catch (error) { console.log(`SEARCH kg ${title}: ${error.message}`) }

    try {
      const wy = await fetchJson(`https://music.163.com/api/search/get?s=${encodeURIComponent(`${title} 周杰伦`)}&type=1&offset=0&limit=10`, { headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' } })
      const items = (wy.result?.songs || []).map(item => ({ ...item, title: item.name, artist: (item.artists || []).map(artist => artist.name).join('、') }))
      const item = pickSong(items, title)
      if (item) {
        const id = String(item.id)
        output.wy.push({ platform: 'wy', id, songmid: id, hash: id, title, name: title, artist: item.artist || '周杰伦', singer: item.artist || '周杰伦', album: item.album?.name || '', albumName: item.album?.name || '', qualities: {}, _types: {}, typeUrl: {} })
      }
    } catch (error) { console.log(`SEARCH wy ${title}: ${error.message}`) }

    try {
      const timestamp = Date.now().toString()
      const deviceId = '963B7AA0D21511ED807EE5846EC87D20'
      const sign = crypto.createHash('md5').update(`${title} 周杰伦6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${timestamp}`).digest('hex')
      const mg = await fetchJson(`https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D&pageSize=10&text=${encodeURIComponent(`${title} 周杰伦`)}&pageNo=1&sort=0&sid=USS`, { headers: { uiVersion: 'A_music_3.6.1', deviceId, timestamp, sign, channel: '0146921', 'User-Agent': 'Mozilla/5.0 (Linux; Android 11)' } })
      const items = (mg.songResultData?.resultList || []).flat().map(item => ({ ...item, title: item.name, artist: (item.singerList || []).map(singer => singer.name).join('、') }))
      const item = pickSong(items, title)
      if (item) {
        const id = String(item.songId || '')
        output.mg.push({ platform: 'mg', id, songmid: id, hash: id, copyrightId: String(item.copyrightId || ''), title, name: title, artist: item.artist || '周杰伦', singer: item.artist || '周杰伦', album: item.album || '', albumName: item.album || '', qualities: {}, _types: {}, typeUrl: {}, lrcUrl: item.lrcUrl, lyricUrl: item.lyricUrl })
      }
    } catch (error) { console.log(`SEARCH mg ${title}: ${error.message}`) }
  }
  return output
}

function makeUtils() {
  const toBuffer = input => Buffer.isBuffer(input) ? input :
    typeof input === 'string' ? Buffer.from(input) : Buffer.from(input.buffer || input)
  return {
    crypto: {
      md5: value => crypto.createHash('md5').update(String(value)).digest('hex'),
      randomBytes: size => new Uint8Array(crypto.randomBytes(size)),
      aesEncrypt(data, mode, key, iv) {
        const keyBuffer = toBuffer(key)
        const algorithm = mode === 'aes-128-ecb' ? 'aes-128-ecb' : 'aes-128-cbc'
        const cipher = crypto.createCipheriv(algorithm, keyBuffer, algorithm.endsWith('ecb') ? null : toBuffer(iv))
        cipher.setAutoPadding(!algorithm.endsWith('ecb'))
        return new Uint8Array(Buffer.concat([cipher.update(toBuffer(data)), cipher.final()]))
      },
      rsaEncrypt() { throw new Error('RSA is not supported by the benchmark runtime') },
    },
    buffer: {
      from(input, encoding) { return new Uint8Array(Buffer.from(input, encoding)) },
      bufToString(input, encoding) { return Buffer.from(input).toString(encoding === 'binary' ? 'latin1' : encoding) },
    },
  }
}

function parseMetadata(code, file) {
  const read = key => (code.match(new RegExp(`^\\s*\\*?\\s*@${key}\\s+(.+)$`, 'm')) || [])[1]?.trim() || ''
  return { file, name: read('name') || file, version: read('version'), author: read('author'), homepage: read('homepage'), rawScript: code }
}

async function createRuntime(file) {
  const code = fs.readFileSync(path.join(sourceDir, file), 'utf8')
  const info = parseMetadata(code, file)
  let requestCount = 0
  let requestHandler = null
  let initSettled = false
  let initResolve
  let initReject
  const initPromise = new Promise((resolve, reject) => { initResolve = resolve; initReject = reject })
  const timers = new Set()

  const trackedSetTimeout = (handler, delay = 0, ...args) => {
    const timer = setTimeout(() => { timers.delete(timer); handler(...args) }, Math.min(Math.max(Number(delay) || 0, 0), 60_000))
    timers.add(timer)
    return timer
  }
  const trackedClearTimeout = timer => { timers.delete(timer); clearTimeout(timer) }

  const lxRequest = (rawUrl, options = {}, callback) => {
    requestCount += 1
    const controller = new AbortController()
    ;(async () => {
      if (requestCount > MAX_SCRIPT_REQUESTS) throw new Error('script request budget exceeded')
      await assertPublicUrl(rawUrl)
      const timeout = Math.min(Math.max(Number(options.timeout) || 10_000, 500), 20_000)
      const timer = setTimeout(() => controller.abort(), timeout)
      try {
        const headers = { ...(options.headers || {}) }
        let body = options.body
        if (options.form && typeof options.form === 'object') {
          body = new URLSearchParams(options.form).toString()
          if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded'
        } else if (body && typeof body === 'object' && !(body instanceof Uint8Array) && !Buffer.isBuffer(body)) {
          body = JSON.stringify(body)
        }
        const response = await fetch(rawUrl, { method: String(options.method || 'GET').toUpperCase(), headers, body, signal: controller.signal, redirect: 'follow' })
        const responseHeaders = Object.fromEntries(response.headers.entries())
        let parsedBody
        if (options.binary === true) {
          parsedBody = new Uint8Array(await response.arrayBuffer())
        } else {
          const text = await response.text()
          try { parsedBody = JSON.parse(text) } catch { parsedBody = text }
        }
        const result = { statusCode: response.status, statusMessage: response.statusText, headers: responseHeaders, body: parsedBody }
        callback(null, result, parsedBody)
      } catch (error) {
        callback(error, null, null)
      } finally {
        clearTimeout(timer)
      }
    })().catch(error => callback(error, null, null))
    return () => controller.abort()
  }

  const lx = {
    EVENT_NAMES,
    request: lxRequest,
    on(eventName, handler) {
      if (eventName === EVENT_NAMES.request) requestHandler = handler
      return Promise.resolve()
    },
    send(eventName, data) {
      if (eventName === EVENT_NAMES.inited && !initSettled) {
        initSettled = true
        initResolve(data || {})
      }
      return Promise.resolve()
    },
    utils: makeUtils(),
    env: 'mobile',
    version: '2.0.0',
    currentScriptInfo: info,
  }

  const context = vm.createContext({
    lx,
    lx_config: {},
    console: { log() {}, info() {}, warn() {}, error() {}, group() {}, groupEnd() {} },
    setTimeout: trackedSetTimeout,
    clearTimeout: trackedClearTimeout,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    AbortController,
    atob,
    btoa,
  }, { codeGeneration: { strings: false, wasm: false } })

  try {
    new vm.Script(code, { filename: file }).runInContext(context, { timeout: 3_000 })
  } catch (error) {
    if (!initSettled) { initSettled = true; initReject(error) }
  }

  let init
  try {
    init = await withTimeout(initPromise, INIT_TIMEOUT_MS, 'initialization')
  } catch (error) {
    for (const timer of timers) clearTimeout(timer)
    throw new Error(`init: ${error.message}`)
  }
  if (typeof requestHandler !== 'function') throw new Error('init: request handler missing')
  return { info, init, requestHandler, requestCount: () => requestCount, dispose: () => { for (const timer of timers) clearTimeout(timer) } }
}

function looksLikeAudio(bytes) {
  if (!bytes || bytes.length < 4) return false
  const ascii = Buffer.from(bytes.slice(0, 12)).toString('ascii')
  return ascii.startsWith('ID3') || ascii.startsWith('fLaC') || ascii.startsWith('OggS') ||
    ascii.includes('ftyp') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
}

async function probeAudio(rawUrl) {
  await assertPublicUrl(rawUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(rawUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-2047', 'User-Agent': 'Cymusic-source-health-check/1.0' },
      redirect: 'follow',
      signal: controller.signal,
    })
    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    const reader = response.body?.getReader()
    const first = reader ? (await reader.read()).value : new Uint8Array()
    if (reader) await reader.cancel()
    const playable = [200, 206].includes(response.status) &&
      (contentType.startsWith('audio/') || contentType.includes('octet-stream') || looksLikeAudio(first))
    return { playable, status: response.status, contentType, finalHost: new URL(response.url || rawUrl).hostname }
  } finally {
    clearTimeout(timer)
  }
}

function supportedSources(init) {
  return Object.entries(init?.sources || {})
    .filter(([, value]) => Array.isArray(value?.actions) && value.actions.includes('musicUrl'))
    .map(([key]) => key)
}

async function testOne(runtime, track, quality) {
  const startedAt = Date.now()
  try {
    const result = await withTimeout(Promise.resolve(runtime.requestHandler({
      action: 'musicUrl',
      source: track.platform,
      info: { musicInfo: track, type: quality },
    })), RESOLVE_TIMEOUT_MS, 'resolve')
    const url = typeof result === 'string' ? result : result?.url
    if (!url || !/^https?:\/\//i.test(url)) throw new Error('invalid URL result')
    const resolveMs = Date.now() - startedAt
    const probe = await probeAudio(url)
    if (!probe.playable) throw new Error(`not audio (${probe.status} ${probe.contentType || 'no-content-type'})`)
    return { ok: true, resolveMs, host: probe.finalHost }
  } catch (error) {
    return { ok: false, resolveMs: Date.now() - startedAt, error: String(error?.message || error).slice(0, 180) }
  }
}

async function benchmarkFile(file, tracks) {
  let runtime
  try {
    runtime = await createRuntime(file)
    const supported = supportedSources(runtime.init)
    const cases = []
    const qualities = mode === 'quality' ? ['320k', 'flac'] : ['128k']
    for (const quality of qualities) {
      for (const platform of ['tx', 'kw', 'kg', 'wy', 'mg']) {
        if (!supported.includes(platform)) continue
        const platformTracks = tracks[platform] || []
        const selectedTracks = mode === 'quality' ? platformTracks.slice(0, 1) : platformTracks.slice(0, 2)
        for (const track of selectedTracks) {
          const result = await testOne(runtime, track, quality)
          cases.push({ platform, title: track.title, quality, ...result })
        }
      }
    }
    const successes = cases.filter(item => item.ok)
    return {
      file,
      name: runtime.info.name,
      version: runtime.info.version,
      supported,
      ok: successes.length,
      total: cases.length,
      successRate: cases.length ? Math.round(successes.length / cases.length * 100) : 0,
      avgResolveMs: successes.length ? Math.round(successes.reduce((sum, item) => sum + item.resolveMs, 0) / successes.length) : null,
      requests: runtime.requestCount(),
      cases,
    }
  } catch (error) {
    return { file, name: file, supported: [], ok: 0, total: 0, successRate: 0, avgResolveMs: null, error: String(error?.message || error).slice(0, 220), cases: [] }
  } finally {
    runtime?.dispose()
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function main() {
  const tracks = await searchTracks()
  console.log(`TRACKS ${Object.entries(tracks).map(([key, value]) => `${key}:${value.length}`).join(' ')}`)
  let files = fs.readdirSync(sourceDir).filter(file => file.endsWith('.js')).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  if (selectedNames.size) files = files.filter(file => selectedNames.has(file))
  const results = await mapLimit(files, 3, async (file, index) => {
    const result = await benchmarkFile(file, tracks)
    console.log(`DONE ${index + 1}/${files.length} ${file} ${result.ok}/${result.total} ${result.successRate}% ${result.avgResolveMs ?? '-'}ms${result.error ? ` ${result.error}` : ''}`)
    return result
  })
  results.sort((a, b) => b.successRate - a.successRate || (b.ok - a.ok) || ((a.avgResolveMs ?? Infinity) - (b.avgResolveMs ?? Infinity)))
  console.log('RESULT_JSON ' + JSON.stringify({ mode, tracks: Object.fromEntries(Object.entries(tracks).map(([key, value]) => [key, value.map(track => ({ title: track.title, id: track.id }))])), results }))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
