export function settingText(value) {
  for (let depth = 0; depth < 4; depth++) {
    if (value === undefined || value === null) return ''
    if (typeof value === 'object') {
      value = Array.isArray(value) ? value[0] : (value.value ?? value.name ?? value.text)
      continue
    }
    if (typeof value !== 'string') return String(value).trim()
    const text = value.trim()
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed === 'string' || (parsed && typeof parsed === 'object')) {
        value = parsed
        continue
      }
    } catch (_) {}
    return text
  }
  return ''
}

export function validateEndpoint(value) {
  let endpoint = value.trim().toLowerCase().replace(/\/+$/, '').replace(/\/healthz$/, '')
  // Accept a bare LAN address; the same private-address validation still applies.
  if (/^\d+\.\d+\.\d+\.\d+(?::\d+)?$/.test(endpoint)) endpoint = 'http://' + endpoint
  // Personal LAN only for HTTP; HTTPS is also supported for a private HTTPS endpoint.
  if (/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(endpoint)) return endpoint
  const m = /^http:\/\/(\d+)\.(\d+)\.(\d+)\.(\d+)(?::\d+)?$/.exec(endpoint)
  if (m) {
    const octets = m.slice(1, 5).map(Number)
    if (octets.every(x => x >= 0 && x <= 255) &&
        (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31))) return endpoint
  }
  throw new Error('Address is missing or invalid. Save the full http:// address first.')
}

function networkError(error) {
  const message = String((error && error.message) || '').toLowerCase()
  if (/cleartext|insecure|https/.test(message)) return new Error('Zepp blocked the HTTP connection. Details: HTTP blocked.')
  if (/timed? ?out|timeout/.test(message)) return new Error('Zepp connection timed out. Details: network timeout.')
  if (/permission|denied|not allowed/.test(message)) return new Error('Zepp could not access the network. Details: network permission.')
  return new Error('Zepp could not send the request. Details: network request failed.')
}

function responseBody(response) {
  try {
    const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body
    if (!body || typeof body !== 'object') throw new Error()
    return body
  } catch (_) { throw new Error('Computer returned an unreadable response. Details: response format.') }
}

export async function pairBridge(readSetting, fetchFn) {
  const endpoint = validateEndpoint(settingText(readSetting('bridge_url')))
  const code = settingText(readSetting('pair_code')).replace(/[\s-]/g, '')
  if (!/^\d{8}$/.test(code)) throw new Error('Pairing code is not saved as eight digits. Edit and save it first.')
  let response
  try {
    response = await fetchFn({url: endpoint + '/v1/pair', method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code})})
  } catch (e) { throw networkError(e) }
  const body = responseBody(response)
  if (!body.ok || typeof body.token !== 'string') {
    throw new Error('Computer rejected the code. Generate a fresh pairing code on the receiver.')
  }
  return body.token
}

export async function checkBridge(readSetting, fetchFn) {
  const endpoint = validateEndpoint(settingText(readSetting('bridge_url')))
  let response
  try { response = await fetchFn({url: endpoint + '/healthz', method: 'GET'}) }
  catch (e) { throw networkError(e) }
  const body = responseBody(response)
  if (body.service !== 'watch-bridge' || body.ok !== true) throw new Error('That address is not the Live Heart receiver.')
  return 'Computer reachable. This checks the network, not watch readings.'
}

export async function relaySample(sample, readSetting, fetchFn) {
  const endpoint = validateEndpoint(settingText(readSetting('bridge_url')))
  const key = settingText(readSetting('bridge_key'))
  if (key.length < 32) throw new Error('Pair Live Heart with your computer in Zepp')
  let response
  try { response = await fetchFn({
    url: endpoint + '/v1/sample', method: 'POST',
    headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key},
    body: JSON.stringify(sample), timeout: 6000
  }) } catch (e) { throw networkError(e) }
  const body = responseBody(response)
  if (!body || body.ok !== true) throw new Error((body && body.error) || 'Bridge rejected the sample')
  return {ok: true, accepted_ts: body.accepted_ts}
}
