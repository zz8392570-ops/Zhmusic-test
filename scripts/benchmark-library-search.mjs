// Synthetic Node benchmark; does not measure device rendering or Hermes latency.
import { performance } from 'node:perf_hooks'
import { loadModule } from './native-services-fixture.mjs'
const { createPersonalLibrarySearch } = loadModule('src/helpers/personalLibrarySearch.ts', {})
const unique = process.argv.includes('--unique')
const collections = Array.from({ length: 20 }, (_, p) => ({
	id: String(p),
	title: `歌单 ${p}`,
	tracks: Array.from({ length: 1000 }, (_, i) => ({
		id: String(unique ? p * 1000 + i : i),
		platform: 'tx',
		title: `歌曲 ${i}`,
		artist: `歌手 ${i % 30}`,
		album: '专辑',
	})),
}))
const queries = ['歌', '歌手', '歌手 1', '999', '不存在']
const started = performance.now()
const search = createPersonalLibrarySearch(collections)
const buildMs = performance.now() - started
for (const query of queries) search(query)
const samples = []
let hits = 0
for (let i = 0; i < 20; i++)
	for (const query of queries) {
		const start = performance.now()
		hits += search(query).tracks.length
		samples.push(performance.now() - start)
	}
samples.sort((a, b) => a - b)
console.log(
	JSON.stringify(
		{
			occurrences: 20000,
			uniqueTracks: unique ? 20000 : 1000,
			queries: samples.length,
			buildMs,
			meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
			p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
			hits,
		},
		null,
		2,
	),
)
