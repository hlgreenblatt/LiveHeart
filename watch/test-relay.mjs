// All readings, times, codes and keys in these tests are synthetic.
import assert from 'node:assert/strict'
import {settingText, validateEndpoint, relaySample, pairBridge, checkBridge} from './app-side/relay.js'

assert.equal(settingText('{"name":" http://192.168.1.100:18962 "}'), 'http://192.168.1.100:18962')
assert.equal(settingText('"abc"'), 'abc')
for (const value of [{value:'00123456'}, {name:'00123456'}, '[{"name":"00123456"}]', '"00123456"']) {
  assert.equal(settingText(value), '00123456')
}
assert.equal(validateEndpoint(' HTTP://192.168.1.100:18962/healthz/ '), 'http://192.168.1.100:18962')
assert.equal(validateEndpoint('http://192.168.1.100:18962/'), 'http://192.168.1.100:18962')
assert.equal(validateEndpoint('192.168.1.100:18962'), 'http://192.168.1.100:18962')
assert.throws(() => validateEndpoint('8.8.8.8:18962'))
for (const address of ['http://example.com', 'http://8.8.8.8', 'http://192.168.999.1', 'file:///tmp/a']) {
  assert.throws(() => validateEndpoint(address))
}
const sample = {ts: 1794000000, bpm: 72, source: 'zepp-watch'}
const settings = {bridge_url: 'http://192.168.1.100:18962', bridge_key: 'test-only-key'.repeat(4)}
for (const stringify of [false, true]) {
  const result = await relaySample(sample, k => settings[k], async request => {
    assert.deepEqual(JSON.parse(request.body), sample)
    assert.equal(request.headers.Authorization, 'Bearer ' + settings.bridge_key)
    const body = {ok: true, accepted_ts: sample.ts}
    return {body: stringify ? JSON.stringify(body) : body}
  })
  assert.equal(result.accepted_ts, sample.ts)
}
await assert.rejects(relaySample(sample, k => settings[k], async () => ({body: {ok: false, error: 'Invalid key'}})))
settings.pair_code = '00123456'
assert.equal(await pairBridge(k => settings[k], async request => {
  assert.equal(request.url, 'http://192.168.1.100:18962/v1/pair')
  assert.equal(JSON.parse(request.body).code, '00123456')
  return {body: JSON.stringify({ok: true, token: 'synthetic-bridge-token'})}
}), 'synthetic-bridge-token')
await assert.rejects(pairBridge(k => k === 'bridge_url' ? '' : settings[k], async () => {
  assert.fail('Invalid address must not make a request')
}), /Address is missing/)
await assert.rejects(pairBridge(k => k === 'pair_code' ? '' : settings[k], async () => {
  assert.fail('Missing code must not make a request')
}), /eight digits/)
await assert.rejects(pairBridge(k => settings[k], async () => {throw Error('Cleartext not permitted')}), /HTTP blocked/)
await assert.rejects(pairBridge(k => settings[k], async () => ({body:{ok:false}})), /rejected the code/)
assert.match(await checkBridge(k => settings[k], async () => ({body:{ok:true,service:'watch-bridge'}})), /Computer reachable/)
console.log('Relay and pairing tests passed: setting formats, leading zeros, address normalization, failures, response formats.')

const activity = {schema:3, source:'zepp-watch', ts:1794000000,
  steps:{ts:1794000000,count:100,since_start:1,session_started_at:1793999990},
  motion:{ts:1794000000,window_start:1793999998,samples:10,rms_variation_cm_s2:12,peak_change_cm_s2:22,x:0,y:0,z:981}}
await relaySample(activity, k => settings[k], async request => {
  assert.deepEqual(JSON.parse(request.body), activity)
  return {body:{ok:true,accepted_ts:activity.ts}}
})
console.log('Activity relay preserves sensor timestamps and units.')
