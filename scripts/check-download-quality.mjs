import fs from 'node:fs/promises'
import { match, P } from 'ts-pattern'
import ts from 'typescript'
import { assert, checks, loadModule } from './native-services-fixture.mjs'
import { createFixture, item as localItem, pathFromUri, write } from './file-system-fixture.mjs'

const { check, finish } = checks()
const fixture = createFixture()
const item = (id, url, extra = {}) => localItem(id, url, { platform: 'tx', ...extra })
const qualityMenu = loadModule('src/helpers/downloadQuality.ts', {
	'@/utils/i18n': { t: (key) => key },
})
const pause = () => new Promise((resolve) => setTimeout(resolve, 5))
const settle = async (h) => {
	for (let attempt = 0; attempt < 400; attempt++) {
		if (
			!h.stores.cacheDownloadTasksStore
				.getValue()
				.some((task) => ['queued', 'downloading'].includes(task.status))
		)
			return
		await pause()
	}
	throw new Error('Download tasks did not settle')
}
const runtime = (
	resolve = async (_track, options) => ({
		url: `https://audio.test/${options.quality}.audio`,
		quality: options.quality,
	}),
) => {
	const requests = []
	const h = fixture.runtime({
		realCache: true,
		moduleOverrides: {
			'@/player/MusicSourceResolver': {
				resolveSource: async (track, options) => {
					requests.push({ track, options })
					return resolve(track, options)
				},
			},
		},
	})
	h.hooks.download = async ({ url, fileUri }) => {
		await write(pathFromUri(fileUri), url)
		return { uri: fileUri, status: 200, headers: {} }
	}
	return {
		...h,
		requests,
		cache: h.load('src/player/CacheManager.ts'),
		manager: h.load('src/player/DownloadManager.ts'),
	}
}

try {
	await check(
		'download picker exposes exactly the three supported qualities and rejects unknown actions',
		() => {
			const actions = qualityMenu.getDownloadQualityActions()
			assert.deepEqual(
				Array.from(actions, (action) => qualityMenu.getDownloadQuality(action.id)),
				['128k', '320k', 'flac'],
			)
			assert.equal(qualityMenu.getDownloadQuality('download'), undefined)
			assert.equal(qualityMenu.getDownloadQuality('download-quality-flac24bit'), undefined)
			assert.equal(qualityMenu.getDownloadQuality('download-quality-320k-other'), undefined)
		},
	)
	await check(
		'128K and 320K files coexist without overwriting or relabeling either recording',
		async () => {
			const h = runtime(),
				track = item('quality-coexist', 'https://audio.test/128k')
			const first = await h.cache.downloadToCache(track, '128k')
			const second = await h.cache.downloadToCache(
				{ ...track, url: 'https://audio.test/320k' },
				'320k',
				undefined,
				undefined,
				true,
				true,
			)
			assert.notEqual(first, second)
			assert.equal(
				await fs.readFile(pathFromUri(h.cache.getCacheFileUri(first)), 'utf8'),
				'https://audio.test/128k',
			)
			assert.equal(
				await fs.readFile(pathFromUri(h.cache.getCacheFileUri(second)), 'utf8'),
				'https://audio.test/320k',
			)
			assert.equal((await h.cache.getCachedAudioInfo(track, false, '128k')).localPath, first)
			assert.equal((await h.cache.getCachedAudioInfo(track, false, '320k')).localPath, second)
			const count = h.calls.downloads.length
			assert.equal(
				await h.cache.downloadToCache(track, '320k', undefined, undefined, true, true),
				second,
			)
			assert.equal(h.calls.downloads.length, count)
		},
	)
	await check(
		'simultaneous quality choices reserve separate files before either download completes',
		async () => {
			const h = runtime(),
				track = item('concurrent-qualities', 'https://audio.test/128k')
			const [low, high] = await Promise.all([
				h.cache.downloadToCache(track, '128k', undefined, 'low', true, true),
				h.cache.downloadToCache(
					{ ...track, url: 'https://audio.test/320k' },
					'320k',
					undefined,
					'high',
					true,
					true,
				),
			])
			assert.notEqual(low, high)
			assert.equal(
				await fs.readFile(pathFromUri(h.cache.getCacheFileUri(low)), 'utf8'),
				'https://audio.test/128k',
			)
			assert.equal(
				await fs.readFile(pathFromUri(h.cache.getCacheFileUri(high)), 'utf8'),
				'https://audio.test/320k',
			)
		},
	)
	await check(
		'FLAC selection bypasses a lower-quality cache and preserves the playback preference',
		async () => {
			const h = runtime(),
				track = item('choose-flac', 'https://audio.test/old-low')
			const old = await h.cache.downloadToCache(track, '128k')
			h.stores.qualityStore.setValue('320k')
			await h.manager.enqueueDownload(track, { quality: 'flac', strictQuality: true })
			await settle(h)
			const task = h.stores.cacheDownloadTasksStore.getValue()[0]
			assert.equal(task.status, 'completed')
			assert.equal(task.quality, 'flac')
			assert.equal(h.requests[0].options.quality, 'flac')
			assert.equal(h.requests[0].options.strictQuality, true)
			assert.equal(h.stores.qualityStore.getValue(), '320k')
			assert.equal(
				await fs.readFile(pathFromUri(h.cache.getCacheFileUri(old)), 'utf8'),
				'https://audio.test/old-low',
			)
		},
	)
	await check(
		'all three qualities have distinct offline records and preserve the original provider ID',
		async () => {
			const h = runtime(),
				track = item('three-versions', 'Unknown')
			for (const quality of ['128k', '320k', 'flac']) {
				await h.manager.enqueueDownload(track, { quality, strictQuality: true })
				await settle(h)
			}
			const records = h.stores.importedLocalMusicStore.getValue()
			assert.equal(records.length, 3)
			assert.equal(new Set(records.map((entry) => `${entry.platform}:${entry.id}`)).size, 3)
			assert.equal(new Set(records.map((entry) => entry.url)).size, 3)
			assert.ok(records.every((entry) => entry.originalId === track.id))
		},
	)
	await check(
		'a source returning a different quality fails instead of silently downloading it',
		async () => {
			const h = runtime(async () => ({ url: 'https://audio.test/low', quality: '128k' }))
			await h.manager.enqueueDownload(item('wrong-quality', 'Unknown'), {
				quality: 'flac',
				strictQuality: true,
			})
			await settle(h)
			const task = h.stores.cacheDownloadTasksStore.getValue()[0]
			assert.equal(task.status, 'failed')
			assert.equal(task.quality, 'flac')
			assert.equal(task.error, 'downloadQuality.unavailable')
			assert.equal(h.calls.downloads.length, 0)
			h.manager.restoreDownloadTasks()
			assert.equal(h.stores.cacheDownloadTasksStore.getValue()[0].strictQuality, true)
		},
	)
	await check(
		'a batch captures one chosen quality and skips duplicate and local tracks',
		async () => {
			const h = runtime()
			const tracks = [
				item('batch-a', 'Unknown'),
				item('batch-b', 'Unknown'),
				item('batch-a', 'Unknown'),
				item('local', 'Unknown', { platform: 'local' }),
			]
			await h.manager.downloadPlaylist(tracks, { quality: '320k', strictQuality: true })
			h.stores.qualityStore.setValue('flac')
			await settle(h)
			assert.equal(h.requests.length, 2)
			assert.ok(
				h.requests.every(({ options }) => options.quality === '320k' && options.strictQuality),
			)
			assert.ok(
				h.stores.cacheDownloadTasksStore
					.getValue()
					.every((task) => task.status === 'completed' && task.quality === '320k'),
			)
		},
	)
	await check(
		'strict source resolution tries other sources at the same quality without playback fallback',
		async () => {
			const attempts = [],
				selected = { id: 'first', name: 'First' },
				backup = { id: 'backup', name: 'Backup' }
			const h = fixture.runtime({
				realCache: true,
				moduleOverrides: {
					'@/helpers/userApi/musicApiControl': {
						getFailedApiIds: () => new Set(),
						getMusicFailureKey: (track) => track.id,
						rememberFailedApi() {},
						recordMusicApiAttempt() {},
						setMusicApiAsSelectedById() {
							throw Error('Downloads must not switch playback source')
						},
						requestMusicUrlFromApi: async (api, _track, quality) => {
							attempts.push({ api: api.id, quality })
							return api.id === 'backup' ? 'https://audio.test/flac' : ''
						},
					},
					'@/helpers/userApi/musicSourceHealth': {
						getFailoverCandidates: () => [backup],
						isValidMusicUrl: (url) => /^https:/.test(url),
						MAX_FAILOVER_SOURCES: 3,
					},
					'@/helpers/userApi/sourceDiagnostics': {
						appendSourceDiagnostic() {},
						classifySourceError: () => 'unknown',
						getSourceErrorMessage: () => '',
					},
					'@/utils/sourceSwitchNotice': { showAutomaticSourceSwitchNotice() {} },
				},
			})
			h.stores.musicApiStore.setValue([selected, backup])
			h.stores.musicApiSelectedStore.setValue(selected)
			const result = await h
				.load('src/player/MusicSourceResolver.ts')
				.resolveSource(item('strict-source', 'Unknown'), {
					requestType: 'download',
					quality: 'flac',
					strictQuality: true,
				})
			assert.equal(result.quality, 'flac')
			assert.deepEqual(
				attempts.map((entry) => entry.quality),
				['flac', 'flac', 'flac'],
			)
			assert.equal(h.stores.musicApiSelectedStore.getValue().id, 'first')
		},
	)

	const react = {
		createElement: (type, props, ...children) => ({
			type,
			props: { ...props, children: children.flat().filter(Boolean) },
		}),
		useState: (initial) => [initial, () => {}],
		useMemo: (compute) => compute(),
		useCallback: (callback) => callback,
	}
	const calls = []
	const common = {
		react,
		'@/helpers/downloadQuality': qualityMenu,
		'@/helpers/trackPlayerIndex': {
			cacheAndImportMusic: async (...args) => calls.push(args),
			downloadPlaylist: async (...args) => calls.push(args),
			repeatModeStore: {},
			MusicRepeatMode: {},
		},
		'@/utils/i18n': { t: (key) => key },
		'@/components/ActionMenu': { MenuView: 'Menu' },
		'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
		'@/styles': { useDefaultStyles: () => ({}) },
		'@/utils/haptics': { hapticLight() {}, hapticSelection() {} },
		'@expo/vector-icons': { Ionicons: 'Icon' },
		'react-native': {
			Alert: { alert() {} },
			View: 'View',
			Text: 'Text',
			TouchableOpacity: 'Button',
			StyleSheet: { create: (styles) => styles },
		},
	}
	await check(
		'the actual player callback forwards its chosen quality through the menu event',
		async () => {
			const source = await fs.readFile(new URL('../src/app/player.tsx', import.meta.url), 'utf8')
			const ast = ts.createSourceFile(
				'player.tsx',
				source,
				ts.ScriptTarget.Latest,
				true,
				ts.ScriptKind.TSX,
			)
			let downloadExpression, eventExpression
			const visit = (node) => {
				if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleDownload')
					downloadExpression = node.initializer.getText(ast)
				if (
					ts.isJsxAttribute(node) &&
					node.name.getText(ast) === 'onPressAction' &&
					node.initializer?.getText(ast).includes('getDownloadQuality(nativeEvent.event)')
				)
					eventExpression = node.initializer.expression.getText(ast)
				ts.forEachChild(node, visit)
			}
			visit(ast)
			assert.ok(downloadExpression && eventExpression)
			const track = item('player-quality', 'Unknown')
			const bind = (expression, globals) => {
				const code = ts.transpileModule(`const callback = ${expression}`, {
					compilerOptions: { target: ts.ScriptTarget.ES2022 },
				}).outputText
				return new Function(...Object.keys(globals), code + '\nreturn callback')(
					...Object.values(globals),
				)
			}
			const download = bind(downloadExpression, {
				useCallback: (callback) => callback,
				trackToDisplay: track,
				myTrackPlayer: common['@/helpers/trackPlayerIndex'],
				Alert: common['react-native'].Alert,
				i18n: common['@/utils/i18n'],
			})
			const handler = bind(eventExpression, {
				getDownloadQuality: qualityMenu.getDownloadQuality,
				handleDownload: download,
			})
			handler({ nativeEvent: { event: 'download-quality-flac' } })
			assert.equal(calls.at(-1)[0], track)
			assert.equal(calls.at(-1)[1].quality, 'flac')
			assert.equal(calls.at(-1)[1].strictQuality, true)
			calls.length = 0
		},
	)
	await check(
		'the real song menu shows choices before enqueueing and forwards the selected quality',
		async () => {
			const { TrackShortcutsMenu } = loadModule(
				'src/components/TrackShortcutsMenu.tsx',
				{
					...common,
					'ts-pattern': { match, P },
					'@/helpers/musicPlatform': {
						supportsCatalogNavigation: () => false,
						getMusicPlatformLabelKey: () => null,
					},
					'@/helpers/userApi/getMusicSource': {},
					'@/store/library': { useFavorites: () => ({ favorites: [] }) },
					'@/store/playList': { isInPlayList: () => false },
					'@/store/queue': { useQueue: () => ({}) },
					'expo-router': { useFocusEffect() {}, useRouter: () => ({}) },
					'@/utils/mediaItem': { isSameMediaItem: () => false },
				},
				{ React: react },
			)
			const track = item('menu-quality', 'Unknown'),
				menu = TrackShortcutsMenu({ track })
			assert.equal(
				menu.props.actions.find((action) => action.id === 'download').subactions.length,
				3,
			)
			assert.equal(calls.length, 0)
			await menu.props.onPressAction({ nativeEvent: { event: 'download-quality-flac' } })
			assert.equal(calls[0][0], track)
			assert.equal(calls[0][1].quality, 'flac')
			assert.equal(calls[0][1].strictQuality, true)
		},
	)
	await check(
		'the real batch menu forwards one choice and excludes local and existing cache rows',
		async () => {
			const { QueueControls } = loadModule(
				'src/components/QueueControls.tsx',
				{ ...common, 'lodash.shuffle': (tracks) => tracks },
				{ React: react },
			)
			const tracks = [
				item('menu-batch', 'Unknown'),
				item('local-menu', 'file:///Documents/a.mp3', { platform: 'local' }),
				item('cached-menu', 'file:///Documents/musicCache/a.mp3'),
			]
			const find = (node) =>
				!node || typeof node !== 'object'
					? []
					: [node, ...(node.props?.children ?? []).flatMap(find)]
			const menu = find(QueueControls({ tracks })).find((node) => node.type === 'Menu')
			const before = calls.length
			await menu.props.onPressAction({ nativeEvent: { event: 'cancel' } })
			assert.equal(calls.length, before)
			await menu.props.onPressAction({ nativeEvent: { event: 'download-quality-320k' } })
			assert.deepEqual(
				Array.from(calls.at(-1)[0], (track) => track.id),
				['menu-batch'],
			)
			assert.equal(calls.at(-1)[1].quality, '320k')
			assert.equal(calls.at(-1)[1].strictQuality, true)
		},
	)
} finally {
	await fixture.dispose()
}
finish()
