import { Buffer } from 'node:buffer'
import { assert, checks, deferred, flush, loadModule } from './native-services-fixture.mjs'

const { check, finish } = checks()
const song = { id: 'one', platform: 'tx', title: 'Song', artist: 'Artist', duration: 226 }
const sample = {
	format: 'zhmusic-backup',
	version: 1,
	createdAt: '2026-10-22T12:00:00Z',
	appVersion: '2.0.0',
	library: { favorites: [song], playlists: [], recentlyPlayed: [] },
	settings: {},
}
const selection = {
	canceled: false,
	assets: [{ uri: 'file:///cache/备份 #1.json', name: '备份 #1.json' }],
}
function fixture() {
	const slots = [],
		cleanups = [],
		alerts = [],
		pickerCalls = [],
		reads = [],
		scrolls = [],
		writes = []
	let cursor = 0,
		updates = 0,
		disposed = false,
		tree,
		remoteCalls = 0
	let pick = async () => selection,
		read = async () => JSON.stringify(sample),
		size = 100
	const values = new Map()
	const persist = {
		get: (key) => values.get(key) ?? null,
		useValue: (key) => values.get(key) ?? null,
		set: (key, value) => {
			writes.push(key)
			values.set(key, value)
		},
	}
	const backup = loadModule('src/helpers/musicBackup.ts', {
		'@/helpers/favoriteGroups': loadModule('src/helpers/favoriteGroups.ts', {}),
		'@/helpers/dislikeRules': loadModule('src/helpers/dislikeRules.ts', {}),
		'@/helpers/downloadFilename': loadModule('src/helpers/downloadFilename.ts', {
			buffer: { Buffer },
		}),
		'@/store/PersistStatus': persist,
		buffer: { Buffer },
	})
	const react = {
		createElement: (type, props, ...children) => ({
			type,
			props: { ...props, children: children.flat().filter(Boolean) },
		}),
		useState(initial) {
			const index = cursor++
			if (!(index in slots)) slots[index] = initial
			return [
				slots[index],
				(next) => {
					assert.equal(disposed, false, 'No updates after unmount')
					updates++
					slots[index] = typeof next === 'function' ? next(slots[index]) : next
				},
			]
		},
		useRef(initial) {
			const index = cursor++
			return (slots[index] ??= { current: initial })
		},
		useEffect(effect) {
			const index = cursor++
			if (!(index in slots)) {
				slots[index] = true
				cleanups.push(effect())
			}
		},
	}
	const Screen = loadModule(
		'src/app/(modals)/backupManager.tsx',
		{
			react,
			'@/helpers/musicBackup': backup,
			'@/helpers/webDavBackup': {
				loadWebDavBackupConfig: async () => undefined,
				saveWebDavBackupConfig: async (config) => config,
				downloadWebDavBackup: async () => {
					remoteCalls++
					return sample
				},
			},
			'@/helpers/trackPlayerIndex': {
				playListsStore: { setValue() {} },
				recentlyPlayedStore: { setValue() {} },
			},
			'@/hooks/useAppTheme': { useThemeColors: () => ({}), useThemeMode: () => ({}) },
			'@/store/library': { useLibraryStore: { setState() {} } },
			'@/player/PlayerStore': {},
			'@/utils/i18n': { t: (key, args) => (args ? `${key}:${JSON.stringify(args)}` : key) },
			'../../../modules/cymusic-native/sharing': {},
			'expo-constants': { expoConfig: {} },
			'@/store/PersistStatus': persist,
			'@/helpers/webDavBackupStatus': {},
			'expo-document-picker': {
				getDocumentAsync: async (options) => {
					pickerCalls.push(options)
					return pick()
				},
			},
			'expo-file-system': {
				Paths: {},
				File: class {
					constructor(uri) {
						this.uri = uri
					}
					get size() {
						return size
					}
					async text() {
						reads.push(this.uri)
						return read()
					}
				},
			},
			'react-native': {
				...Object.fromEntries(
					[
						'ActivityIndicator',
						'KeyboardAvoidingView',
						'Pressable',
						'ScrollView',
						'Switch',
						'Text',
						'TextInput',
						'View',
					].map((key) => [key, key]),
				),
				Platform: { OS: 'ios' },
				Alert: { alert: (...args) => alerts.push(args) },
			},
		},
		{ React: react },
	).default
	const nodes = (node) =>
		!node || typeof node !== 'object' ? [] : [node, ...(node.props?.children ?? []).flatMap(nodes)]
	const render = () => {
		cursor = 0
		tree = Screen()
		const scroll = nodes(tree).find((node) => node.type === 'ScrollView')
		if (scroll.props.ref)
			scroll.props.ref.current = { scrollTo: (position) => scrolls.push(position) }
		return tree
	}
	const text = (node) =>
		typeof node === 'string' ? node : (node?.props?.children ?? []).map(text).join(' ')
	const press = (label) => {
		const button = nodes(tree).find((node) => node.type === 'Pressable' && text(node) === label)
		assert.ok(button, `Missing button ${label}`)
		button.props.onPress()
	}
	render()
	return {
		render,
		nodes: () => nodes(tree),
		text: () => text(tree),
		press,
		alerts,
		pickerCalls,
		reads,
		scrolls,
		writes,
		backup,
		get remoteCalls() {
			return remoteCalls
		},
		get updates() {
			return updates
		},
		pick: (fn) => {
			pick = fn
		},
		read: (fn) => {
			read = fn
		},
		size: (value) => {
			size = value
		},
		unmount() {
			for (const cleanup of cleanups) cleanup?.()
			disposed = true
		},
	}
}

await check(
	'selected backup appears beside import controls and writes only after restore confirmation',
	async () => {
		const h = fixture()
		h.press('backup.import')
		await flush()
		h.render()
		assert.ok(h.text().includes('backup.fileReady'))
		assert.ok(h.text().includes('备份 #1.json'))
		const nodes = h.nodes()
		const label = (node) => node.props?.children?.[0]?.props?.children?.[0]
		const restoreIndex = nodes.findIndex(
			(node) => node.type === 'Pressable' && label(node) === 'backup.restore',
		)
		const webDavIndex = nodes.findIndex(
			(node) => node.type === 'Text' && node.props.children[0] === 'backup.webdavTitle',
		)
		assert.ok(restoreIndex >= 0 && restoreIndex < webDavIndex)
		assert.ok(h.text().indexOf('backup.preview') < h.text().indexOf('backup.webdavTitle'))
		assert.equal(h.reads[0], selection.assets[0].uri)
		assert.equal(h.pickerCalls[0].copyToCacheDirectory, true)
		assert.equal(h.writes.length, 0)
		assert.equal(h.scrolls.length, 1)
		h.press('backup.restore')
		assert.equal(h.writes.length, 0)
		assert.equal(h.alerts[0][0], 'backup.confirmTitle')
		h.alerts[0][2][1].onPress()
		await flush()
		assert.ok(h.writes.includes('music.favorites'))
		assert.equal(h.alerts.at(-1)[0], 'backup.restored')
		h.render()
		assert.ok(!h.text().includes('backup.fileReady'))
	},
)
await check(
	'picker and reader show progress, reject overlapping requests, and release after cancel',
	async () => {
		const h = fixture(),
			gate = deferred(),
			text = deferred()
		h.pick(() => gate.promise)
		h.read(() => text.promise)
		h.press('backup.import')
		h.press('backup.import')
		h.press('backup.webdavDownload')
		h.render()
		assert.equal(h.pickerCalls.length, 1)
		assert.equal(h.remoteCalls, 0)
		assert.ok(h.text().includes('backup.choosingFile'))
		gate.resolve(selection)
		await flush()
		h.render()
		assert.ok(h.text().includes('backup.readingFile'))
		text.resolve(JSON.stringify(sample))
		await flush()
		h.render()
		assert.ok(h.text().includes('backup.fileReady'))
		h.pick(async () => ({ canceled: true }))
		h.press('backup.import')
		await flush()
		h.render()
		assert.equal(h.alerts.length, 0)
		assert.equal(h.writes.length, 0)
		assert.ok(h.text().includes('backup.preview'))
		assert.ok(!h.text().includes('backup.choosingFile'))
		assert.equal(h.pickerCalls.length, 2)
	},
)
await check(
	'picker errors, unreadable files, invalid data and size limits give visible retryable feedback',
	async () => {
		for (const failure of ['picker', 'read', 'invalid', 'size', 'asset']) {
			const h = fixture()
			h.press('backup.import')
			await flush()
			h.render()
			assert.ok(h.text().includes('backup.preview'))
			if (failure === 'picker')
				h.pick(async () => {
					throw new Error('Native presenter unavailable')
				})
			if (failure === 'read')
				h.read(async () => {
					throw new Error('File unavailable')
				})
			if (failure === 'invalid') h.read(async () => '{}')
			if (failure === 'size') h.size(h.backup.MAX_BACKUP_BYTES + 1)
			if (failure === 'asset') h.pick(async () => ({ canceled: false, assets: [] }))
			h.press('backup.import')
			await flush()
			h.render()
			const message =
				failure === 'picker'
					? 'backup.pickerFailed'
					: ['read', 'asset'].includes(failure)
						? 'backup.readFailed'
						: 'backup.invalid'
			assert.equal(h.alerts[0][0], message)
			assert.ok(h.text().includes(message))
			assert.equal(h.writes.length, 0)
			assert.ok(!h.text().includes('backup.preview'))
			h.pick(async () => selection)
			h.read(async () => JSON.stringify(sample))
			h.size(100)
			h.press('backup.import')
			await flush()
			h.render()
			assert.ok(h.text().includes('backup.fileReady'))
		}
	},
)
await check(
	'late picker and read completion cannot update or restore an unmounted screen',
	async () => {
		for (const stage of ['picker', 'read']) {
			const h = fixture(),
				gate = deferred()
			if (stage === 'picker') h.pick(() => gate.promise)
			else h.read(() => gate.promise)
			h.press('backup.import')
			await flush()
			h.unmount()
			const before = h.updates
			gate.resolve(stage === 'picker' ? selection : JSON.stringify(sample))
			await flush()
			assert.equal(h.updates, before)
			assert.equal(h.writes.length, 0)
			assert.equal(h.alerts.length, 0)
		}
	},
)
await check('remote backup also reveals the shared preview without applying it', async () => {
	const h = fixture()
	h.press('backup.webdavDownload')
	await flush()
	h.render()
	assert.equal(h.remoteCalls, 1)
	assert.equal(h.scrolls.length, 1)
	assert.ok(h.text().indexOf('backup.preview') < h.text().indexOf('backup.webdavTitle'))
	assert.equal(h.writes.length, 0)
})
finish()
