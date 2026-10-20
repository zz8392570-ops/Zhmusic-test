import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { assert, checks, deferred, flush, loadModule, root } from './native-services-fixture.mjs'

const { check, finish } = checks()
const state = (initial) => {
	let value = initial
	return {
		getValue: () => value,
		setValue: (next) => {
			value = next
		},
	}
}
const script = (id, name = id) =>
	`module.exports = { id: '${id}', name: '${name}', getMusicUrl: async () => 'https://audio.test/${name}' }`
const file = (name, content) => ({ name, read: async () => content })
function fixture({ empty = false } = {}) {
	const disk = new Map(),
		alerts = [],
		progress = [],
		errors = []
	let fail = false,
		runtimeLoads = 0
	const existing = {
		id: 'existing',
		name: 'Existing',
		script: script('existing'),
		isSelected: true,
		scriptType: 'zhmusic',
		getMusicUrl: async () => 'old',
	}
	const stores = {
		musicApiStore: state(empty ? [] : [existing]),
		musicApiSelectedStore: state(empty ? null : existing),
		musicApiTestingStore: state(false),
		nowApiState: state(null),
	}
	const logger = { logInfo() {}, logError: (...args) => errors.push(args) }
	const adapter = {
		isLxMusicScript: (text) => text.startsWith('LX:'),
		adaptLxMusicScript: async (text) => {
			runtimeLoads++
			if (text === 'LX:invalid') throw new Error('LX initialization failed')
			return {
				id: `lx-${runtimeLoads}`,
				name: 'LX',
				script: text,
				scriptType: 'lxmusic',
				getMusicUrl: async () => 'https://audio.test/lx',
			}
		},
		reloadLxMusicScript: async (api) => api,
		disposeLxMusicScript() {},
	}
	const importer = loadModule(
		'src/helpers/userApi/importMusicSource.ts',
		{ '@/utils/i18n': { t: (key) => key }, './lxMusicSourceAdapter': adapter },
		{ Error },
	)
	const control = loadModule(
		'src/helpers/userApi/musicApiControl.ts',
		{
			'@/utils/i18n': { t: (key) => key },
			'@/store/PersistStatus': {
				get: (key) => disk.get(key),
				set: (key, value) => {
					if (fail && key === 'music.musicApi') {
						fail = false
						throw new Error('Storage full')
					}
					disk.set(key, value)
				},
			},
			'@/helpers/requestControl': loadModule('src/helpers/requestControl.ts', {}),
			'@/player/PlayerStore': stores,
			'@/utils/utils': { showToast() {} },
			'@/utils/sourceSwitchNotice': {},
			'react-native': { Alert: { alert: (...args) => alerts.push(args) } },
			'../logger': logger,
			'./musicSourceHealth': {},
			'./lxMusicSourceAdapter': adapter,
		},
		{ Error },
	)
	const batch = loadModule(
		'src/helpers/userApi/batchMusicSourceImport.ts',
		{
			'@/player/PlayerStore': stores,
			'@/helpers/logger': logger,
			'./importMusicSource': importer,
			'./musicApiControl': control,
		},
		{ Error },
	)
	return {
		...batch,
		control,
		stores,
		disk,
		alerts,
		errors,
		progress,
		failNextWrite: () => {
			fail = true
		},
		loads: () => runtimeLoads,
	}
}
await check(
	'mixed files import independently; identical scripts and declared IDs skip without overwriting',
	async () => {
		const h = fixture()
		const existing = h.stores.musicApiStore.getValue()[0]
		const result = await h.importMusicSourceFiles(
			[
				file('new.js', script('new')),
				file('copy.js', '  ' + script('new') + '\n'),
				file('same-id.js', script('existing', 'Replacement')),
				file('bad.js', 'module.exports = {}'),
				{
					name: 'unreadable.js',
					read: async () => {
						throw new Error('File unavailable')
					},
				},
				file('LX.js', 'LX:valid'),
				file('LX-copy.js', 'LX:valid'),
				file('broken-LX.js', 'LX:invalid'),
				file('last.js', script('last')),
			],
			(completed, total) => h.progress.push([completed, total]),
		)
		assert.equal(result.imported, 3)
		assert.equal(result.skipped, 3)
		assert.equal(result.failures.length, 3)
		assert.equal(h.loads(), 2)
		assert.equal(h.stores.musicApiStore.getValue()[0], existing)
		assert.equal(h.stores.musicApiSelectedStore.getValue().id, 'existing')
		assert.equal(
			await h.stores.musicApiSelectedStore.getValue().getMusicUrl(),
			'https://audio.test/existing',
		)
		assert.equal(h.alerts.length, 0)
		assert.equal(h.disk.get('music.musicApi').length, 4)
		assert.equal(h.progress.length, 9)
		assert.deepEqual(h.progress.at(-1), [9, 9])
	},
)
await check(
	'scripts without IDs receive distinct identities and file names; storage failure leaves no phantom import',
	async () => {
		const h = fixture()
		h.failNextWrite()
		const result = await h.importMusicSourceFiles([
			file('no-space.js', script('failed')),
			file('first.js', "module.exports.getMusicUrl = async () => 'https://audio.test/first'"),
			file('second.js', "module.exports.getMusicUrl = async () => 'https://audio.test/second'"),
		])
		assert.equal(result.imported, 2)
		assert.equal(result.failures[0].name, 'no-space.js')
		const list = h.stores.musicApiStore.getValue()
		assert.equal(list.length, 3)
		assert.notEqual(list[1].id, list[2].id)
		assert.equal(list[1].name, 'first')
		assert.equal(list[2].name, 'second')
		assert.equal(
			list.some((api) => api.id === 'failed'),
			false,
		)
	},
)
await check(
	'first source is selected on an empty installation and parsing waits for the runtime lock',
	async () => {
		const h = fixture({ empty: true }),
			gate = deferred()
		let parsing = false
		const holding = h.control.withMusicSourceImport(() => gate.promise)
		const pending = h.control.withMusicSourceImport(async () => {
			parsing = true
		})
		await flush()
		assert.equal(parsing, false)
		gate.resolve()
		await Promise.all([holding, pending])
		assert.equal(parsing, true)
		const result = await h.importMusicSourceFiles([
			file('first.js', script('first')),
			file('second.js', script('second')),
		])
		await flush()
		assert.equal(result.imported, 2)
		assert.equal(h.stores.musicApiSelectedStore.getValue().id, 'first')
	},
)

await check(
	'actual file picker supports multi-select, handles cancellation and prevents concurrent imports',
	async () => {
		const owner = 'src/app/(modals)/settingModal.tsx'
		const source = ts.createSourceFile(
			owner,
			fs.readFileSync(path.join(root, owner), 'utf8'),
			ts.ScriptTarget.Latest,
			true,
		)
		const statement = source.statements.find(
			(node) =>
				ts.isVariableStatement(node) &&
				node.declarationList.declarations.some(
					(decl) => decl.name.getText(source) === 'importMusicSourceFromFile',
				),
		)
		const compiled = ts.transpileModule(statement.getText(source), {
			compilerOptions: { target: ts.ScriptTarget.ES2022 },
		}).outputText
		const h = fixture(),
			alerts = [],
			selections = [],
			updates = [],
			gate = deferred()
		let nextResult = gate.promise
		const contents = new Map([
			['one', script('one')],
			['bad', 'module.exports = {}'],
		])
		const dependencies = {
			DocumentPicker: {
				getDocumentAsync: async (options) => {
					selections.push(options)
					return nextResult
				},
			},
			File: class {
				constructor(uri) {
					this.uri = uri
				}
				async text() {
					return contents.get(this.uri)
				}
			},
			importMusicSourceFiles: h.importMusicSourceFiles,
			sourceFileImportProgress: { setValue: (value) => updates.push(value) },
			i18n: { t: (key, values) => JSON.stringify({ key, ...values }) },
			Alert: { alert: (...args) => alerts.push(args) },
			logInfo() {},
			logError() {},
		}
		const run = new Function(
			...Object.keys(dependencies),
			'let isMusicSourceFilePickerOpen = false;\n' +
				compiled +
				'\nreturn importMusicSourceFromFile',
		)(...Object.values(dependencies))
		const first = run()
		await run()
		assert.equal(selections.length, 1)
		assert.equal(selections[0].multiple, true)
		assert.equal(selections[0].copyToCacheDirectory, true)
		gate.resolve({ canceled: true })
		await first
		assert.equal(updates.at(-1), null)
		nextResult = Promise.resolve({
			canceled: false,
			assets: [
				{ uri: 'one', name: 'one.js' },
				{ uri: 'bad', name: 'bad.js' },
			],
		})
		await run()
		assert.equal(
			h.stores.musicApiStore.getValue().some((api) => api.id === 'one'),
			true,
		)
		assert.match(alerts.at(-1)[1], /"imported":1,"skipped":0,"failed":1/)
		assert.equal(updates.at(-1), null)
		assert.equal(alerts.length, 2)
	},
)
finish()
