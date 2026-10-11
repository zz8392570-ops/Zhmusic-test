import { waitForRequest } from '@/helpers/requestControl'

export const HEALTH_TEST_TIMEOUT_MS = 4000
export const HEALTH_TEST_QUALITY: IMusic.IQualityKey = '128k'
export const MAX_FAILOVER_SOURCES = 3

export const HEALTH_TEST_TRACKS = [
	{ title: '稻香', artist: '周杰伦', id: '004IArbh3ytHgR' },
	{ title: '晴天', artist: '周杰伦', id: '003OUlho2HcRHC' },
	{ title: '七里香', artist: '周杰伦', id: '0025NhlN2yWrP4' },
	{ title: '夜曲', artist: '周杰伦', id: '001RaE8n4MAvFL' },
	{ title: '花海', artist: '周杰伦', id: '003aAYrm3GE0Ac' },
	{ title: '青花瓷', artist: '周杰伦', id: '000MkMni19ClZt' },
	{ title: '简单爱', artist: '周杰伦', id: '002bRNpg3Fq3SD' },
	{ title: '告白气球', artist: '周杰伦', id: '003OUlho2PUYGF' },
]

/** Prefer actual catalog IDs, keeping the original metadata required by LX scripts. */
export const selectHealthTestTracks = (
	tracks: IMusic.IMusicItem[],
	multiPlatform = true,
): IMusic.IMusicItem[] => {
	const selected: IMusic.IMusicItem[] = []
	const seen = new Set<string>()
	const artists = new Set<string>()
	const platforms = new Set<string>()
	const candidates = tracks.filter(
		(track) =>
			track.id &&
			track.title &&
			track.artist &&
			['tx', 'kw', 'kg', 'wy', 'mg'].includes(track.platform) &&
			(multiPlatform || track.platform === 'tx'),
	)
	for (const diverseOnly of [true, false]) {
		for (const track of candidates) {
			const key = `${track.platform}:${track.id}`
			if (
				seen.has(key) ||
				(diverseOnly && artists.has(track.artist) && platforms.has(track.platform))
			)
				continue
			selected.push(track)
			seen.add(key)
			artists.add(track.artist)
			platforms.add(track.platform)
			if (selected.length === 8) return selected
		}
	}
	for (const track of HEALTH_TEST_TRACKS) {
		if (selected.length >= 8) break
		if (!seen.has(`tx:${track.id}`))
			selected.push({ ...track, platform: 'tx' } as IMusic.IMusicItem)
	}
	return selected
}

const STATUS_RANK: Record<IMusic.MusicApiHealthStatus, number> = {
	normal: 0,
	partial: 1,
	idle: 2,
	testing: 3,
	dead: 4,
}

export const isValidMusicUrl = (url: unknown): url is string =>
	typeof url === 'string' && /^https?:\/\//i.test(url) && !url.includes('fake')

export const classifyMusicApiHealth = (
	successCount: number,
	totalCount: number,
): IMusic.MusicApiHealthStatus => {
	if (totalCount <= 0 || successCount <= 0) return 'dead'
	if (successCount / totalCount >= 0.8) return 'normal'
	return 'partial'
}

export const createIdleHealth = (): IMusic.MusicApiHealth => ({
	successCount: 0,
	totalCount: 0,
	latencyMs: null,
	status: 'idle',
})

export const createTestingHealth = (prev?: IMusic.MusicApiHealth): IMusic.MusicApiHealth => ({
	...prev,
	successCount: prev?.successCount ?? 0,
	totalCount: prev?.totalCount ?? HEALTH_TEST_TRACKS.length,
	latencyMs: prev?.latencyMs ?? null,
	status: 'testing',
	testedAt: prev?.testedAt,
})

export const getHealthPercent = (health?: IMusic.MusicApiHealth | null): number | null => {
	if (!health || !health.totalCount || health.status === 'idle' || health.status === 'testing') {
		return null
	}
	return Math.round((health.successCount / health.totalCount) * 100)
}

export const sortMusicApis = (apis: IMusic.MusicApi[]): IMusic.MusicApi[] =>
	[...apis].sort((a, b) => {
		const failuresA = a.health?.consecutiveFailures ?? 0
		const failuresB = b.health?.consecutiveFailures ?? 0
		if (failuresA !== failuresB) return failuresA - failuresB
		const rankA = STATUS_RANK[a.health?.status ?? 'idle']
		const rankB = STATUS_RANK[b.health?.status ?? 'idle']
		if (rankA !== rankB) return rankA - rankB
		const latencyA = a.health?.averageResponseMs ?? a.health?.latencyMs ?? Number.POSITIVE_INFINITY
		const latencyB = b.health?.averageResponseMs ?? b.health?.latencyMs ?? Number.POSITIVE_INFINITY
		if (latencyA !== latencyB) return latencyA - latencyB
		return String(a.name).localeCompare(String(b.name), 'zh')
	})

export const getFailoverCandidates = (
	apis: IMusic.MusicApi[],
	selectedId?: string | null,
	excludeIds: Iterable<string> = [],
): IMusic.MusicApi[] => {
	const excluded = new Set(excludeIds)
	const sorted = sortMusicApis(apis).filter((api) => api.id && !excluded.has(api.id))
	if (!selectedId) return sorted.slice(0, MAX_FAILOVER_SOURCES)
	const selected = sorted.find((api) => api.id === selectedId && api.health?.status !== 'dead')
	const rest = sorted.filter((api) => api.id !== selected?.id)
	return (selected ? [selected, ...rest] : rest).slice(0, MAX_FAILOVER_SOURCES)
}

export async function probeMusicApi(
	getMusicUrl: IMusic.MusicApi['getMusicUrl'],
	tracks = selectHealthTestTracks([]),
): Promise<IMusic.MusicApiHealth> {
	const totalCount = tracks.length
	if (typeof getMusicUrl !== 'function') {
		return {
			successCount: 0,
			totalCount,
			latencyMs: null,
			status: 'dead',
			testedAt: Date.now(),
		}
	}

	let successCount = 0
	let networkFailures = 0
	const latencies: number[] = []
	const qualitySupport: Partial<Record<IMusic.IQualityKey, boolean>> = {}

	for (const track of tracks) {
		const startedAt = Date.now()
		for (const quality of [HEALTH_TEST_QUALITY, '320k'] as IMusic.IQualityKey[]) {
			try {
				const url = await waitForRequest(
					() =>
						getMusicUrl(track.title, track.artist, track.id, quality, {
							platform: track.platform,
							musicItem: track,
						}),
					HEALTH_TEST_TIMEOUT_MS,
				)
				if (isValidMusicUrl(url)) {
					successCount += 1
					qualitySupport[quality] = true
					latencies.push(Date.now() - startedAt)
					break
				}
			} catch (error) {
				if (/timeout|timed out|超时|network|offline|socket|dns|网络/i.test(String(error))) {
					networkFailures++
					break
				}
			}
		}
	}

	return {
		successCount,
		totalCount,
		latencyMs: latencies.length
			? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
			: null,
		// A small sample cannot prove an entire catalog is unavailable.
		status: successCount ? classifyMusicApiHealth(successCount, totalCount) : 'idle',
		lastProbeIssue: successCount ? undefined : networkFailures ? 'network' : 'catalog',
		qualitySupport,
		testedAt: Date.now(),
	}
}
