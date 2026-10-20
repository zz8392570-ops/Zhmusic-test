import { Buffer } from 'node:buffer'
import { assert, checks, loadModule } from './native-services-fixture.mjs'

const { check, finish } = checks()
const naming = loadModule('src/helpers/downloadFilename.ts', { buffer: { Buffer } })
const track = { id: '1', platform: 'tx', title: 'Song', artist: 'Artist', album: 'Album' }
await check('templates support metadata and actual-quality extensions', () => {
	assert.equal(
		naming.formatDownloadFilename(track, '320k', '{title} - {artist}'),
		'Song - Artist.mp3',
	)
	assert.equal(
		naming.formatDownloadFilename(track, 'flac', '{album} [{quality}] {id}'),
		'Album [flac] 1.flac',
	)
	assert.equal(naming.formatDownloadFilename(track, '128k'), 'Song - Artist.mp3')
	for (const rule of ['', '../{title}', '{title}/{artist}', '{unknown}', '{album}', '{title'])
		assert.equal(naming.isValidDownloadTemplate(rule), false)
})
await check(
	'names cannot escape directories or duplicate extensions and remain UTF-8 bounded',
	() => {
		assert.equal(
			naming.formatDownloadFilename({ ...track, title: '../CON.mp3' }, '320k', '{title}'),
			'-CON.mp3',
		)
		const long = naming.formatDownloadFilename(
			{ ...track, title: '🎵'.repeat(200) },
			'flac',
			'{title}',
		)
		assert.ok(Buffer.byteLength(long) <= 185)
		assert.equal(long.includes('\ufffd'), false)
	},
)

await check(
	'concurrent duplicate names stay distinct; both download kinds honor rules while existing lookup stays stable',
	async () => {
		const values = new Map([['music.downloadFilenameTemplate', '{title} - {artist}']])
		const files = new Set(['file:///Documents/musicCache/'])
		const state = (value) => ({ getValue: () => value, setValue() {} })
		const cache = loadModule('src/player/CacheManager.ts', {
			'@/utils/i18n': {
				t: (key) => (key === 'cacheCenter.errors.diskSpace' ? '设备剩余空间不足' : key),
			},
			'@/helpers/downloadFilename': naming,
			'@/helpers/logger': { logInfo() {}, logError() {} },
			'./PlayerStore': {
				qualityStore: state('320k'),
				cacheRevisionStore: state(0),
				importedLocalMusicStore: state([]),
			},
			'@/store/PersistStatus': {
				get: (key) => values.get(key) ?? null,
				set: (key, value) => values.set(key, value),
			},
			'expo-file-system/legacy': {
				documentDirectory: 'file:///Documents/',
				getInfoAsync: async (uri) => ({ exists: files.has(uri) }),
				makeDirectoryAsync() {},
			},
			'@/helpers/fileDownload': { downloadFile: async (url, uri) => files.add(uri) },
			'@/helpers/localFile': {
				fileUriFromPath: (path) => `file://${path}`,
				resolveLocalFile: async () => ({ status: 'nonlocal' }),
			},
			'../../modules/cymusic-native': { documentDirectoryPath: '/Documents' },
			'@/helpers/audioQuality': {
				normalizeAudioQuality: (value) => value,
				inferAudioQualityFromPath: () => '320k',
			},
		})
		const [first, second] = await Promise.all([
			cache.downloadToCache(track, '320k', undefined, 'one', true),
			cache.downloadToCache({ ...track, id: '2' }, '320k', undefined, 'two', true),
		])
		assert.equal(first, 'file:///Documents/musicCache/Song - Artist.mp3')
		assert.equal(second, 'file:///Documents/musicCache/Song - Artist (2).mp3')
		values.set('music.downloadFilenameTemplate', '{artist} - {title}')
		assert.equal(cache.getLocalFilePath(track, '320k'), first)
		assert.equal((await cache.getCachedAudioInfo(track)).localPath, first)
		assert.equal(
			await cache.downloadToCache({ ...track, id: '3' }, '128k'),
			'file:///Documents/musicCache/Artist - Song.mp3',
		)
		files.delete(first)
		assert.equal(
			await cache.downloadToCache(track, '320k'),
			'file:///Documents/musicCache/Artist - Song (2).mp3',
		)
	},
)
await check(
	'settings editor previews and saves valid rules, rejects invalid rules; backup includes rule',
	() => {
		const values = new Map()
		const store = {
			get: (key) => values.get(key) ?? null,
			set: (key, value) => values.set(key, value),
		}
		const states = []
		let cursor = 0
		const alerts = []
		const react = {
			createElement: (type, props, ...children) => ({
				type,
				props: { ...props, children: children.flat() },
			}),
			useState: (initial) => {
				const index = cursor++
				if (!(index in states)) states[index] = initial
				return [
					states[index],
					(next) => {
						states[index] = next
					},
				]
			},
		}
		const screen = loadModule('src/app/(modals)/downloadNaming.tsx', {
			react,
			'react-native': {
				Alert: { alert: (...args) => alerts.push(args) },
				Pressable: 'Button',
				ScrollView: 'Scroll',
				Text: 'Text',
				TextInput: 'Input',
				View: 'View',
			},
			'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
			'@/store/PersistStatus': store,
			'@/utils/i18n': { t: (key) => key },
			'@/helpers/downloadFilename': naming,
		}).default
		const flatten = (node) =>
			!node || typeof node !== 'object' ? [] : [node, ...node.props.children.flatMap(flatten)]
		const render = () => {
			cursor = 0
			return flatten(screen())
		}
		let nodes = render()
		nodes.find((node) => node.type === 'Input').props.onChangeText('{title} - {artist}')
		nodes = render()
		assert.ok(
			nodes.some(
				(node) =>
					node.type === 'Text' &&
					node.props.children.includes(
						'downloadNaming.exampleTitle - downloadNaming.exampleArtist.mp3',
					),
			),
		)
		const save = () =>
			render()
				.filter((node) => node.type === 'Button')
				.at(-1)
				.props.onPress()
		save()
		assert.equal(values.get('music.downloadFilenameTemplate'), '{title} - {artist}')
		nodes.find((node) => node.type === 'Input').props.onChangeText('../{title}')
		save()
		assert.equal(values.get('music.downloadFilenameTemplate'), '{title} - {artist}')
		assert.equal(alerts.at(-1)[0], 'common.error')
		const backup = loadModule('src/helpers/musicBackup.ts', {
			'@/helpers/dislikeRules': loadModule('src/helpers/dislikeRules.ts', {}),
			'@/helpers/favoriteGroups': loadModule('src/helpers/favoriteGroups.ts', {}),
			'@/store/PersistStatus': store,
			buffer: { Buffer },
			'@/helpers/downloadFilename': naming,
		})
		const exported = backup.createMusicBackup('1.2.0')
		assert.equal(
			backup.parseMusicBackup(JSON.stringify(exported)).settings['music.downloadFilenameTemplate'],
			'{title} - {artist}',
		)
		values.set('music.downloadFilenameTemplate', '../{title}')
		assert.equal(
			backup.createMusicBackup('1.2.0').settings['music.downloadFilenameTemplate'],
			undefined,
		)
	},
)
finish()
