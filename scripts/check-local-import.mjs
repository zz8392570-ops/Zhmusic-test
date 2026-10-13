import fs from 'node:fs/promises'
import {
	createFixture,
	deepFreeze,
	item,
	uri,
	write,
	exists,
} from './file-system-fixture.mjs'
import { assert, checks, deferred } from './native-services-fixture.mjs'

const suite = checks()
const fixture = createFixture()
const { documents, temporary } = fixture

async function picked(name, title, content = name) {
	const path = `${temporary}/picker/${name}.mp3`
	await write(path, content)
	return item(uri(path), uri(path), { title, artist: 'Artist', genre: 'same.mp3' })
}

try {
	await suite.check('same-name imports preserve every source and existing file without mutating inputs', async () => {
		const h = fixture.runtime()
		const importer = h.load('src/helpers/trackPlayerIndex.ts').default
		const first = deepFreeze(await picked('same-a', 'Collision', 'first audio'))
		const second = deepFreeze(await picked('same-b', 'Collision', 'second audio'))
		const existing = `${documents}/importedLocalMusic/Collision-Artist.mp3`
		await write(existing, 'existing audio')
		const result = await importer.addImportedLocalMusic([first, second], true, false)
		assert.equal(result.status, 'success')
		assert.equal(result.imported, 2)
		const saved = h.stores.importedLocalMusicStore.getValue()
		assert.equal(saved[0].url, `${documents}/importedLocalMusic/Collision-Artist (2).mp3`)
		assert.equal(saved[1].url, `${documents}/importedLocalMusic/Collision-Artist (3).mp3`)
		assert.equal(await fs.readFile(existing, 'utf8'), 'existing audio')
		assert.equal(await fs.readFile(saved[0].url, 'utf8'), 'first audio')
		assert.equal(await fs.readFile(saved[1].url, 'utf8'), 'second audio')
		assert.equal(await fs.readFile(`${temporary}/picker/same-a.mp3`, 'utf8'), 'first audio')
		assert.equal(await fs.readFile(`${temporary}/picker/same-b.mp3`, 'utf8'), 'second audio')
		assert.equal(first.url, first.id)
		assert.equal(second.url, second.id)
		assert.equal(h.calls.moves.length, 0)
		assert.equal(h.calls.alerts.length, 0)
	})

	await suite.check('a later copy failure retains and reports earlier successful registrations', async () => {
		const h = fixture.runtime()
		const importer = h.load('src/helpers/trackPlayerIndex.ts').default
		const first = await picked('partial-good', 'Partial good')
		const second = await picked('partial-fail', 'Partial fail')
		h.hooks.copy = async ({ from }) => {
			if (from === second.url) throw new Error('Injected copy failure')
		}
		const result = await importer.addImportedLocalMusic([first, second], true, false)
		assert.equal(result.status, 'partial')
		assert.equal(result.imported, 1)
		assert.equal(result.failures.length, 1)
		assert.equal(result.failures[0].id, second.id)
		const stored = h.persistence.get('music.importedLocalMusic')
		assert.equal(stored.length, 1)
		assert.equal(stored[0].id, first.id)
		assert.equal(await exists(stored[0].url), true)
		assert.equal(await exists(`${documents}/importedLocalMusic/Partial fail-Artist.mp3`), false)
		assert.equal(await exists(`${temporary}/picker/partial-fail.mp3`), true)
	})

	await suite.check('long Chinese and emoji names stay within the byte limit and retain unique suffixes', async () => {
		const h = fixture.runtime()
		const importer = h.load('src/helpers/trackPlayerIndex.ts').default
		const title = '很长的歌曲名称🎵'.repeat(30)
		const first = await picked('long-name-a', title, 'long a')
		const second = await picked('long-name-b', title, 'long b')
		first.artist = second.artist = '很多歌手的名字🎤'.repeat(30)
		const result = await importer.addImportedLocalMusic([first, second], true, false)
		assert.equal(result.status, 'success')
		const saved = h.persistence.get('music.importedLocalMusic')
		for (const track of saved) {
			const filename = track.url.split('/').at(-1)
			assert(Buffer.byteLength(filename, 'utf8') < 190)
			assert.equal(Buffer.from(filename).toString('utf8'), filename)
			assert(filename.endsWith('.mp3'))
			assert.equal(await exists(track.url), true)
		}
		assert(saved[1].url.endsWith(' (2).mp3'))
	})

	await suite.check('a failed storage write removes only its copy and subsequent files can succeed', async () => {
		const h = fixture.runtime()
		const importer = h.load('src/helpers/trackPlayerIndex.ts').default
		const first = await picked('persist-fail', 'Storage failed')
		const second = await picked('persist-good', 'Storage good')
		const persist = h.persistence.set
		let writes = 0
		h.persistence.set = (key, value) => {
			if (key === 'music.importedLocalMusic' && writes++ === 0)
				throw new Error('Injected storage failure')
			persist(key, value)
		}
		const result = await importer.addImportedLocalMusic([first, second], true, false)
		assert.equal(result.status, 'partial')
		assert.equal(result.imported, 1)
		assert.equal(result.failures[0].reason, 'storage')
		assert.equal(await exists(`${documents}/importedLocalMusic/Storage failed-Artist.mp3`), false)
		assert.equal(await exists(`${temporary}/picker/persist-fail.mp3`), true)
		assert.equal(h.stores.importedLocalMusicStore.getValue().length, 1)
		assert.equal(h.persistence.get('music.importedLocalMusic')[0].id, second.id)
	})

	await suite.check('a listener failure after a durable write does not delete the registered audio', async () => {
		const h = fixture.runtime()
		const importer = h.load('src/helpers/trackPlayerIndex.ts').default
		const track = await picked('after-write', 'Saved listener failure')
		const persist = h.persistence.set
		h.persistence.set = (key, value) => {
			persist(key, value)
			throw new Error('Injected post-write listener failure')
		}
		const result = await importer.addImportedLocalMusic([track], true, false)
		assert.equal(result.status, 'success')
		assert.equal(result.imported, 1)
		const saved = h.persistence.get('music.importedLocalMusic')[0]
		assert.equal(await exists(saved.url), true)
		assert.equal(h.calls.deletes.length, 0)
	})

	await suite.check('unreadable persistence after a write preserves the copy and stops the rest of the batch', async () => {
		const h = fixture.runtime()
		const importer = h.load('src/helpers/trackPlayerIndex.ts').default
		const first = await picked('uncertain-first', 'Uncertain first')
		const second = await picked('uncertain-second', 'Uncertain second')
		const persist = h.persistence.set
		const read = h.persistence.get
		let failed = false
		h.persistence.set = (key, value) => {
			persist(key, value)
			failed = true
			throw new Error('Injected ambiguous write')
		}
		h.persistence.get = (key) => {
			if (failed) throw new Error('Injected unreadable storage')
			return read(key)
		}
		const result = await importer.addImportedLocalMusic([first, second], true, false)
		assert.equal(result.status, 'error')
		assert.equal(result.imported, 0)
		assert.equal(result.failures.length, 2)
		assert.equal(result.failures[0].cleanupFailed, true)
		assert.equal(await exists(`${documents}/importedLocalMusic/Uncertain first-Artist.mp3`), true)
		assert.equal(await exists(`${documents}/importedLocalMusic/Uncertain second-Artist.mp3`), false)
		assert.equal(h.calls.copies.length, 1)
	})

	await suite.check('two concurrent same-name batches preserve cache records registered during the copy', async () => {
		const h = fixture.runtime()
		const importer = h.load('src/helpers/trackPlayerIndex.ts').default
		const first = await picked('concurrent-a', 'Concurrent song')
		const second = await picked('concurrent-b', 'Concurrent song')
		const entered = deferred()
		const release = deferred()
		h.hooks.copy = async ({ from }) => {
			if (from === first.url) {
				entered.resolve()
				await release.promise
			}
		}
		const pendingFirst = importer.addImportedLocalMusic([first], true, false)
		await entered.promise
		const pendingSecond = importer.addImportedLocalMusic([second], true, false)
		const cached = item('new-cache', `${documents}/musicCache/new-cache.mp3`)
		h.persistence.set('music.importedLocalMusic', [cached])
		h.stores.importedLocalMusicStore.setValue([cached])
		release.resolve()
		const results = await Promise.all([pendingFirst, pendingSecond])
		assert.equal(results[0].status, 'success')
		assert.equal(results[1].status, 'success')
		const saved = h.persistence.get('music.importedLocalMusic')
		assert.equal(saved.length, 3)
		assert.equal(saved[0].id, cached.id)
		assert.equal(new Set(saved.map((track) => track.url)).size, 3)
		assert.equal(await fs.readFile(saved[1].url, 'utf8'), 'concurrent-a')
		assert.equal(await fs.readFile(saved[2].url, 'utf8'), 'concurrent-b')
	})

	await suite.check('already-owned cache registration leaves its URL unchanged and performs no file I/O', async () => {
		const h = fixture.runtime()
		const importer = h.load('src/helpers/trackPlayerIndex.ts').default
		const cached = deepFreeze(item('unchanged-cache', `${documents}/musicCache/song.flac`))
		h.hooks.exists = async () => {
			throw new Error('Unexpected filesystem operation')
		}
		const result = await importer.addImportedLocalMusic([cached], false, false)
		assert.equal(result.status, 'success')
		assert.equal(h.persistence.get('music.importedLocalMusic')[0].url, cached.url)
		assert.equal(h.calls.fs.length, 0)
		assert.equal(h.calls.copies.length, 0)
		assert.equal(h.calls.moves.length, 0)
		assert.equal((await importer.addImportedLocalMusic([cached], false, false)).status, 'empty')
	})

	await suite.check('different platforms may register the same provider ID without dropping a cache record', async () => {
		const h = fixture.runtime()
		const importer = h.load('src/helpers/trackPlayerIndex.ts').default
		const first = item('shared-id', `${documents}/musicCache/tx_shared-id.mp3`, { platform: 'tx' })
		const second = item('shared-id', `${documents}/musicCache/kw_shared-id.mp3`, { platform: 'kw' })
		const result = await importer.addImportedLocalMusic([first, second], false, false)
		assert.equal(result.status, 'success')
		assert.equal(result.imported, 2)
		assert.equal(h.persistence.get('music.importedLocalMusic').length, 2)
	})

	await suite.check('missing and nonlocal picker sources cannot be reported as imported', async () => {
		const h = fixture.runtime()
		const importer = h.load('src/helpers/trackPlayerIndex.ts').default
		const result = await importer.addImportedLocalMusic(
			[
				item('missing-input', uri(`${temporary}/picker/not-present.mp3`)),
				item('remote-input', 'https://example.test/song.mp3'),
			],
			true,
			false,
		)
		assert.equal(result.status, 'error')
		assert.equal(result.imported, 0)
		assert.equal(result.failures.length, 2)
		assert.equal(h.stores.importedLocalMusicStore.getValue().length, 0)
		assert.equal(h.calls.copies.length, 0)
	})
} finally {
	await fixture.dispose()
	suite.finish()
}
