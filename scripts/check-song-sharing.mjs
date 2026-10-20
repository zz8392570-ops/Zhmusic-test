import fs from 'node:fs'
import ts from 'typescript'
import { assert, checks, deferred, flush, loadModule, root } from './native-services-fixture.mjs'

const { check, finish } = checks()
const song = (url = 'https://audio.example/song.mp3') => ({
	id: 'song',
	platform: 'tx',
	title: '歌曲 A',
	artist: '歌手',
	url,
})
const translations = {
	t: (key, values) => (key === 'player.shareMessage' ? `${values.title} · ${values.artist}` : key),
}

function shareFixture(platform = 'ios') {
	const calls = [],
		alerts = [],
		errors = []
	let implementation = async () => ({ action: 'dismissedAction' })
	let localResolver = async () => ({ status: 'nonlocal' })
	const sharing = loadModule(
		'src/helpers/shareSong.ts',
		{
			'react-native': {
				Platform: { OS: platform },
				Share: {
					share: (content) => {
						calls.push(content)
						return implementation(content)
					},
				},
				Alert: { alert: (...args) => alerts.push(args) },
			},
			'@/utils/i18n': translations,
			'./logger': { logError: (...args) => errors.push(args) },
			'./localFile': { resolveLocalFile: (uri) => localResolver(uri) },
		},
		{ URL },
	)
	return {
		...sharing,
		calls,
		alerts,
		errors,
		setImplementation: (next) => {
			implementation = next
		},
		setLocalResolver: (next) => {
			localResolver = next
		},
	}
}

function menuFixture({
	platform = 'ios',
	onPressAction = () => {},
	actions = [{ id: 'share', title: 'Share' }],
} = {}) {
	let cursor = 0,
		props,
		tree
	const slots = [],
		cleanups = []
	const react = {
		Fragment: 'Fragment',
		createElement: (type, attributes, ...children) => ({
			type,
			props: { ...attributes, children: children.flat().filter(Boolean) },
		}),
		Children: { only: (child) => child },
		isValidElement: (child) => !!child?.props,
		cloneElement: (child, attributes) => ({ ...child, props: { ...child.props, ...attributes } }),
		useState: (initial) => {
			const index = cursor++
			if (!(index in slots)) slots[index] = initial
			return [
				slots[index],
				(value) => {
					slots[index] = value
				},
			]
		},
		useRef: (initial) => {
			const index = cursor++
			return (slots[index] ??= { current: initial })
		},
		useEffect: (effect) => {
			const index = cursor++
			if (!(index in slots)) {
				slots[index] = true
				cleanups.push(effect())
			}
		},
	}
	const { MenuView } = loadModule(
		'src/components/ActionMenu.tsx',
		{
			react,
			'react-native': {
				Modal: 'Modal',
				Platform: { OS: platform },
				Pressable: 'Pressable',
				ScrollView: 'ScrollView',
				Text: 'Text',
				View: 'View',
			},
			'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
			'@/hooks/useAppTheme': { useThemeColors: () => ({}) },
			'@/utils/i18n': translations,
		},
		{ React: react },
	)
	props = { actions, onPressAction, children: react.createElement('Trigger', {}) }
	const nodes = (node) =>
		!node || typeof node !== 'object' ? [] : [node, ...(node.props?.children ?? []).flatMap(nodes)]
	const render = (next) => {
		props = { ...props, ...next }
		cursor = 0
		tree = MenuView(props)
		return tree
	}
	render()
	return {
		render,
		open() {
			nodes(tree)
				.find((node) => node.type === 'Trigger')
				.props.onPress()
			render()
		},
		select(id) {
			const node = nodes(tree).find((node) => node.type === 'Pressable' && node.props.key === id)
			assert.ok(node, `Missing action ${id}`)
			node.props.onPress()
		},
		modal: () => nodes(tree).find((node) => node.type === 'Modal'),
		unmount: () => cleanups.forEach((cleanup) => cleanup?.()),
	}
}

await check(
	'iOS menu dispatches the captured selection only after dismissal and ignores duplicate taps/events',
	() => {
		const calls = []
		const h = menuFixture({
			onPressAction: ({ nativeEvent }) => calls.push('original:' + nativeEvent.event),
		})
		h.open()
		h.select('share')
		h.select('share')
		assert.equal(calls.length, 0)
		h.render({ onPressAction: ({ nativeEvent }) => calls.push('replacement:' + nativeEvent.event) })
		assert.equal(h.modal().props.visible, false)
		assert.equal(calls.length, 0)
		h.modal().props.onDismiss()
		h.modal().props.onDismiss()
		assert.deepEqual(calls, ['original:share'])
		h.open()
		h.select('share')
		h.modal().props.onDismiss()
		assert.deepEqual(calls, ['original:share', 'replacement:share'])
	},
)
await check(
	'submenus and disabled entries do not dispatch; cancel or unmount cannot run a retired selection',
	() => {
		const calls = []
		const h = menuFixture({
			actions: [
				{ id: 'download', title: 'Download', subactions: [{ id: 'flac', title: 'FLAC' }] },
				{ id: 'disabled', title: 'Disabled', attributes: { disabled: true } },
			],
			onPressAction: (event) => calls.push(event),
		})
		h.open()
		h.select('disabled')
		assert.equal(calls.length, 0)
		h.select('download')
		h.render()
		assert.equal(h.modal().props.visible, true)
		assert.equal(calls.length, 0)
		h.modal().props.onRequestClose()
		h.render()
		h.modal().props.onDismiss()
		assert.equal(calls.length, 0)
		h.open()
		h.select('download')
		h.render()
		h.select('flac')
		h.unmount()
		h.modal().props.onDismiss()
		assert.equal(calls.length, 0)
	},
)
await check('Android menu actions do not depend on the iOS-only dismissal event', () => {
	const calls = []
	const h = menuFixture({
		platform: 'android',
		onPressAction: ({ nativeEvent }) => calls.push(nativeEvent.event),
	})
	h.open()
	h.select('share')
	assert.deepEqual(calls, ['share'])
	h.render()
	assert.equal(h.modal().props.visible, false)
	h.open()
	h.select('share')
	assert.equal(calls.length, 2)
})
await check(
	'song sharing keeps valid network URLs but shares metadata for pending, malformed and local sources',
	async () => {
		const h = shareFixture()
		for (const url of [
			'Unknown',
			'',
			'/var/mobile/song.mp3',
			'file:///var/mobile/song.mp3',
			'fixture://fake-audio.mp3',
			'data:audio/mp3;base64,AAAA',
			'https://',
		]) {
			await h.shareSong(song(url))
			assert.equal(h.calls.at(-1).url, undefined)
			assert.equal(h.calls.at(-1).message, '歌曲 A · 歌手')
		}
		await h.shareSong(song())
		assert.equal(h.calls.at(-1).url, song().url)
		assert.equal(h.alerts.length, 0)
		const android = shareFixture('android')
		await android.shareSong(song())
		assert.ok(android.calls[0].message.includes(song().url))
	},
)
await check(
	'iOS file sharing uses a verified current local URI and missing files still share song information',
	async () => {
		const h = shareFixture()
		const oldUri = 'file:///old-container/song.mp3',
			currentUri = 'file:///current-container/song.mp3'
		h.setLocalResolver(async (uri) => {
			assert.equal(uri, oldUri)
			return { status: 'resolved', fileUri: currentUri }
		})
		await h.shareSong(song(oldUri))
		assert.equal(h.calls[0].url, currentUri)
		assert.equal(h.calls[0].message, '歌曲 A · 歌手')
		h.setLocalResolver(async () => ({ status: 'missing' }))
		await h.shareSong(song(oldUri))
		assert.equal(h.calls[1].url, undefined)
		assert.equal(h.alerts.length, 0)
	},
)
await check(
	'sharing cancellation and errors release the active request; errors and missing songs show visible feedback',
	async () => {
		const h = shareFixture(),
			pending = deferred()
		h.setImplementation(() => pending.promise)
		const first = h.shareSong(song())
		await h.shareSong(song())
		assert.equal(h.calls.length, 1)
		pending.resolve({ action: 'dismissedAction' })
		await first
		assert.equal(h.alerts.length, 0)
		h.setImplementation(async () => {
			throw new Error('Native share failure')
		})
		await h.shareSong(song())
		assert.equal(h.errors.length, 1)
		assert.equal(h.alerts[0][0], 'player.shareFailed')
		h.setImplementation(async () => ({ action: 'sharedAction' }))
		await h.shareSong(song())
		assert.equal(h.calls.length, 3)
		await h.shareSong(null)
		assert.equal(h.calls.length, 3)
		assert.equal(h.alerts.at(-1)[0], 'player.shareUnavailable')
		await h.shareSong({ ...song(), title: ' ', artist: '' })
		assert.equal(h.calls.at(-1).title, 'find.unknownSong')
	},
)
await check(
	'the real player share callback and menu event reach the share owner after the menu closes',
	async () => {
		const source = fs.readFileSync(root + '/src/app/player.tsx', 'utf8')
		const ast = ts.createSourceFile(
			'player.tsx',
			source,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TSX,
		)
		let callbackExpression, menuExpression
		const visit = (node) => {
			if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleShare')
				callbackExpression = node.initializer.getText(ast)
			if (
				ts.isJsxAttribute(node) &&
				node.name.getText(ast) === 'onPressAction' &&
				node.initializer?.getText(ast).includes("case 'share'")
			)
				menuExpression = node.initializer.expression.getText(ast)
			ts.forEachChild(node, visit)
		}
		visit(ast)
		assert.ok(callbackExpression && menuExpression)
		const bind = (expression, globals) => {
			const code = ts.transpileModule(`const callback = ${expression}`, {
				compilerOptions: { target: ts.ScriptTarget.ES2022 },
			}).outputText
			return new Function(...Object.keys(globals), code + '\nreturn callback')(
				...Object.values(globals),
			)
		}
		const h = shareFixture()
		const callback = bind(callbackExpression, {
			useCallback: (fn) => fn,
			shareSong: h.shareSong,
			trackToDisplay: song(),
		})
		const handler = bind(menuExpression, { getDownloadQuality: () => null, handleShare: callback })
		const menu = menuFixture({ onPressAction: handler })
		menu.open()
		menu.select('share')
		assert.equal(h.calls.length, 0)
		menu.render()
		menu.modal().props.onDismiss()
		await flush()
		assert.equal(h.calls.length, 1)
		assert.equal(h.calls[0].title, song().title)
		assert.equal(h.alerts.length, 0)
	},
)

finish()
