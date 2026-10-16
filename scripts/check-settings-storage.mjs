import { produce } from 'immer'
import { assert, checks, deferred, flush, loadModule } from './native-services-fixture.mjs'
const { check, finish } = checks()

await check('storage reports both successful writes and write/serialization failures', async () => {
	const storage = loadModule('src/helpers/storage.ts', {
		'@react-native-async-storage/async-storage': {
			setItem: async (key) => {
				if (key === 'fail') throw new Error('disk full')
			},
		},
		'./logger': { logError() {} },
	})
	assert.equal(await storage.setStorage('ok', { value: true }), true)
	assert.equal(await storage.setStorage('fail', { value: true }), false)
	const circular = {}
	circular.self = circular
	assert.equal(await storage.setStorage('circular', circular), false)
})

await check(
	'failed config saves do not publish state; queued updates retain each successful change',
	async () => {
		const first = deferred()
		const writes = []
		const alerts = []
		let fail = true
		const { default: config } = loadModule('src/store/config.ts', {
			immer: { produce },
			react: {},
			'@/helpers/storage': {
				getStorage: async () => ({}),
				setStorage: async (key, value) => {
					writes.push(value)
					if (writes.length === 1) await first.promise
					return !fail
				},
			},
			'react-native': { Alert: { alert: (...args) => alerts.push(args) } },
			'@/utils/i18n': { t: (key) => key },
		})
		await config.setup()
		const rejected = config.set('setting.basic.autoPlayWhenAppStart', true)
		await flush()
		assert.equal(config.get('setting.basic.autoPlayWhenAppStart'), undefined)
		first.resolve()
		assert.equal(await rejected, false)
		assert.equal(config.get('setting.basic.autoPlayWhenAppStart'), undefined)
		assert.equal(alerts.length, 1)
		fail = false
		const a = config.set('setting.basic.autoPlayWhenAppStart', true)
		const b = config.set('setting.basic.useCelluarNetworkPlay', false)
		assert.equal(await a, true)
		assert.equal(await b, true)
		assert.equal(config.get('setting.basic.autoPlayWhenAppStart'), true)
		assert.equal(config.get('setting.basic.useCelluarNetworkPlay'), false)
		assert.equal(writes.at(-1).setting.basic.autoPlayWhenAppStart, true)
	},
)
finish()
