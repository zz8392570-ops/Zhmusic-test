import { assert, checks, deferred, flush, loadModule } from './native-services-fixture.mjs'
const { check, finish } = checks()
const sharing = loadModule('src/helpers/songSharing.ts', {})
const preview = loadModule('src/helpers/downloadPreview.ts', { './songSharing': sharing })
const song = (id = '123', extra = {}) => ({
	id,
	platform: 'wy',
	title: 'Song',
	artist: 'Artist',
	duration: 180,
	url: 'https://audio.test/file?token=private',
	...extra,
})
await check(
	'provider links use validated provider IDs, cached originals and never playback tokens',
	() => {
		const cases = [
			[song(), 'https://music.163.com/#/song?id=123'],
			[song('cache:wy:123', { originalId: '123' }), 'https://music.163.com/#/song?id=123'],
			[
				song('004IArbh3ytHgR', { platform: 'tx' }),
				'https://y.qq.com/n/ryqq/songDetail/004IArbh3ytHgR',
			],
			[song('12', { platform: 'tx' }), 'https://i.y.qq.com/v8/playsong.html?songid=12'],
			[song('23', { platform: 'kw' }), 'https://www.kuwo.cn/play_detail/23'],
			[
				song('42', { platform: 'kg', hash: 'a'.repeat(32) }),
				`https://www.kugou.com/song/#hash=${'a'.repeat(32)}`,
			],
			[
				song('999', { platform: 'mg', copyrightId: '60012345678' }),
				'https://music.migu.cn/v3/music/song/60012345678',
			],
		]
		for (const [track, expected] of cases) {
			assert.equal(sharing.getSongPageUrl(track), expected)
			assert.equal(expected.includes('private'), false)
		}
		for (const track of [
			song('../23'),
			song('id?token=secret'),
			song('0'),
			song('123', { platform: 'local' }),
			song('123', { platform: 'unknown' }),
			song('123', { platform: 'mg' }),
			song('123', { platform: 'kg', hash: 'invalid' }),
		])
			assert.equal(sharing.getSongPageUrl(track), undefined)
	},
)
await check(
	'download preview deduplicates exact tracks, excludes local files and estimates only the chosen quality',
	() => {
		const tracks = preview.getDownloadCandidates([
			song(),
			song(),
			song('local', { platform: 'local' }),
			song('cache', { url: 'file:///Documents/a.mp3' }),
			song('raw', { url: '/Documents/a.mp3' }),
			song('other', { qualities: { flac: { size: '12.5 MB' } } }),
		])
		assert.equal(tracks.length, 2)
		const flac = preview.estimateDownloadSize(tracks, 'flac')
		assert.equal(flac.bytes, 12.5 * 1024 ** 2)
		assert.equal(flac.unknown, 1)
		assert.equal(preview.estimateDownloadSize([song()], '320k').bytes, 7_200_000)
		assert.equal(
			preview.estimateDownloadSize([song('x', { source: { flac: { size: 12345 } } })], 'flac')
				.bytes,
			12345,
		)
		assert.equal(preview.estimateDownloadSize([song('bad', { duration: NaN })], '128k').unknown, 1)
		assert.equal(
			preview.estimateDownloadSize(
				[song('bad', { qualities: { flac: { size: '-4 MB' } } })],
				'flac',
			).bytes,
			0,
		)
	},
)
await check(
	'real confirmation captures quality and tracks, reports space, and does not enqueue until confirmation',
	async () => {
		const alerts = [],
			queued = [],
			gate = deferred()
		const owner = loadModule('src/helpers/confirmPlaylistDownload.ts', {
			'react-native': { Alert: { alert: (...args) => alerts.push(args) } },
			'expo-file-system/legacy': { getFreeDiskStorageAsync: () => gate.promise },
			'@/utils/i18n': { t: (key, values) => `${key}:${JSON.stringify(values)}` },
			'./downloadPreview': preview,
		})
		const track = song(),
			tracks = [track],
			enqueue = async (...args) => queued.push(args)
		const pending = owner.confirmPlaylistDownload(tracks, '320k', enqueue)
		await owner.confirmPlaylistDownload(tracks, 'flac', enqueue)
		track.id = 'changed'
		tracks.push(song('late'))
		gate.resolve(1024)
		await pending
		assert.equal(alerts.length, 1)
		assert.equal(queued.length, 0)
		assert.match(alerts[0][1], /offline.lowSpace/)
		assert.match(alerts[0][1], /6.9 MB/)
		alerts[0][2][0].onPress()
		assert.equal(queued.length, 0)
		await owner.confirmPlaylistDownload([song()], '128k', enqueue)
		alerts.at(-1)[2][1].onPress()
		await flush()
		assert.equal(queued[0][1].quality, '128k')
		assert.equal(queued[0][1].strictQuality, true)
		assert.equal(queued[0][0].length, 1)
	},
)
await check(
	'unknown disk space and FLAC sizes remain explicit and allow a later retry',
	async () => {
		const alerts = []
		const owner = loadModule('src/helpers/confirmPlaylistDownload.ts', {
			'react-native': { Alert: { alert: (...args) => alerts.push(args) } },
			'expo-file-system/legacy': {
				getFreeDiskStorageAsync: async () => {
					throw Error('unavailable')
				},
			},
			'@/utils/i18n': { t: (key) => key },
			'./downloadPreview': preview,
		})
		await owner.confirmPlaylistDownload([song()], 'flac', async () => {})
		assert.match(alerts[0][1], /offline.free/)
		alerts[0][3].onDismiss()
		await owner.confirmPlaylistDownload([song()], '320k', async () => {})
		assert.equal(alerts.length, 2)
		alerts[1][2][0].onPress()
	},
)
await check(
	'offline probes distinguish missing from errors, bound concurrency, share pending calls and recheck later',
	async () => {
		const gate = deferred()
		let active = 0,
			peak = 0,
			calls = 0
		const { createOfflineAvailabilityLookup } = loadModule('src/helpers/offlineAvailability.ts', {
			'./songSharing': sharing,
			'./localFile': { resolveLocalFile() {} },
		})
		const get = createOfflineAvailabilityLookup(async (url, options) => {
			assert.equal(options.requireOwnedMedia, true)
			calls++
			active++
			peak = Math.max(peak, active)
			await gate.promise
			active--
			return url.endsWith('missing')
				? { status: 'unresolved', reason: 'missing' }
				: url.endsWith('error')
					? { status: 'unresolved', reason: 'unreadable' }
					: { status: 'resolved' }
		})
		const first = get('/Documents/a')
		assert.equal(get('/Documents/a'), first)
		const all = [
			'/Documents/missing',
			'/Documents/error',
			...Array.from({ length: 8 }, (_, i) => `/Documents/${i}`),
		].map(get)
		await flush()
		assert.equal(active, 4)
		gate.resolve()
		assert.equal(await first, 'available')
		const states = await Promise.all(all)
		assert.equal(states[0], 'missing')
		assert.equal(states[1], 'unknown')
		assert.equal(peak, 4)
		await flush()
		const before = calls
		await get('/Documents/a')
		assert.equal(calls, before + 1)
		assert.equal(await get('https://audio.test/a'), 'unknown')
	},
)
function hooks() {
	let cursor = 0
	const slots = []
	return {
		reset: () => {
			cursor = 0
		},
		react: {
			createElement: (type, props, ...children) => ({
				type,
				props: { ...props, children: children.flat().filter(Boolean) },
			}),
			useCallback: (callback) => callback,
			useRef(initial) {
				const index = cursor++
				return (slots[index] ??= { current: initial })
			},
			useState(initial) {
				const index = cursor++
				if (!(index in slots)) slots[index] = initial
				return [
					slots[index],
					(next) => {
						slots[index] = typeof next === 'function' ? next(slots[index]) : next
					},
				]
			},
		},
	}
}
await check(
	'offline labels retire old row probes and show verified local or active download state',
	async () => {
		const h = hooks(),
			old = deferred()
		let focus,
			cleanup,
			tasks = []
		const Label = loadModule(
			'src/components/OfflineAvailabilityLabel.tsx',
			{
				react: h.react,
				'react-native': { Text: 'Text' },
				'expo-router': {
					useFocusEffect: (callback) => {
						focus = callback
					},
				},
				'@/player/PlayerStore': {
					cacheRevisionStore: { useValue: () => 0, getValue: () => 0 },
					cacheDownloadTasksStore: { useValue: () => tasks },
				},
				'@/helpers/offlineAvailability': {
					getOfflineAvailability: (url) =>
						url.endsWith('old')
							? old.promise
							: Promise.resolve(url.endsWith('missing') ? 'missing' : 'available'),
				},
				'@/helpers/songSharing': sharing,
				'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
				'@/utils/i18n': { t: (key) => key },
			},
			{ React: h.react },
		).default
		const render = (track) => {
			h.reset()
			return Label({ track })
		}
		const refocus = () => {
			cleanup?.()
			cleanup = focus()
		}
		let track = song('old', { url: '/Documents/old' })
		render(track)
		refocus()
		track = song('new', { url: '/Documents/new', cacheKind: 'saved' })
		render(track)
		refocus()
		await flush()
		assert.equal(render(track).props.children[0], 'offline.saved')
		old.resolve('missing')
		await flush()
		assert.equal(render(track).props.children[0], 'offline.saved')
		track = song('missing', { url: '/Documents/missing' })
		render(track)
		refocus()
		await flush()
		assert.equal(render(track).props.children[0], 'offline.missing')
		tasks = [{ track: song('remote'), status: 'downloading', progress: 0.5 }]
		assert.equal(render(song('remote')).props.children[0], 'cacheCenter.downloading')
		assert.equal(render(song('no-task')), null)
		cleanup?.()
	},
)
await check(
	'continue card never starts playback on render and restores the retained queue only on user actions',
	async () => {
		const h = hooks(),
			track = song(),
			gate = deferred(),
			calls = [],
			navigation = []
		let queue = []
		const savedQueue = [track, song('next')],
			values = { 'music.musicItem': track, 'music.play-list': savedQueue, 'music.progress': 47 }
		const Card = loadModule(
			'src/components/ContinueListening.tsx',
			{
				react: h.react,
				'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View' },
				'expo-router': {
					router: {
						navigate: (path) => navigation.push(path),
						push: (path) => navigation.push(path),
					},
				},
				'@expo/vector-icons': { Ionicons: 'Icon' },
				'@rntp/player': { useIsPlaying: () => false },
				'@/helpers/trackPlayerIndex': {
					__esModule: true,
					default: {
						useCurrentMusic: () => null,
						usePlayList: () => queue,
						useProgress: () => ({ position: 0 }),
						getPlayList: () => queue,
						addAll: (tracks) => {
							queue = tracks
							calls.push('restore-queue')
						},
						continueLastSession: async () => {
							calls.push('resume')
							return gate.promise
						},
					},
					recentlyPlayedStore: { useValue: () => [] },
				},
				'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
				'@/store/PersistStatus': { useValue: (key) => values[key], get: (key) => values[key] },
				'@/helpers/miscellaneous': { formatSecondsToMinutes: (value) => String(value) },
				'@/utils/utils': { showToast: () => calls.push('error') },
				'@/utils/i18n': { t: (key) => key },
			},
			{ React: h.react },
		).default
		const nodes = (node) =>
			!node || typeof node !== 'object'
				? []
				: [node, ...(node.props?.children ?? []).flatMap(nodes)]
		const render = () => {
			h.reset()
			return Card()
		}
		const buttons = nodes(render()).filter((node) => node.type === 'Pressable')
		assert.deepEqual(calls, [])
		buttons[1].props.onPress()
		assert.deepEqual(calls, ['restore-queue'])
		assert.equal(queue, savedQueue)
		assert.equal(navigation.at(-1), '/(modals)/playList')
		buttons[0].props.onPress()
		buttons[0].props.onPress()
		assert.deepEqual(calls, ['restore-queue', 'resume'])
		assert.equal(navigation.at(-1), '/player')
		gate.resolve(true)
		await flush()
		assert.equal(nodes(render()).find((node) => node.type === 'Pressable').props.disabled, false)
	},
)
finish()
