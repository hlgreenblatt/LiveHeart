// Zepp documents timer IDs as numbers, with no sign/range guarantee.
// Treat them as opaque handles. Logical positive IDs protect ZML's truthy checks.
export function timerFailure(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function validTimerHandle(id) {
  return typeof id === 'number' && Number.isFinite(id)
}

export function createNativeTimers(api) {
  let next = 1
  const handles = new Map()
  return {
    setTimeout(callback, delay) {
      if (!api || typeof api.createSysTimer !== 'function' || typeof api.stopTimer !== 'function') {
        throw timerFailure('T0', 'System timer API unavailable')
      }
      const logical = next++
      let native
      try {
        native = api.createSysTimer(false, delay, () => { handles.delete(logical); callback() })
      } catch (e) {
        throw timerFailure('T1', String((e && e.message) || e || 'Native timer call failed'))
      }
      if (!validTimerHandle(native)) throw timerFailure('T2', 'Timer returned ' + typeof native)
      handles.set(logical, native)
      return logical
    },
    clearTimeout(logical) {
      if (!handles.has(logical)) return
      const native = handles.get(logical)
      handles.delete(logical)
      api.stopTimer(native)
    }
  }
}

export function readableFailure(error, fallback = 'S0') {
  const code = error && typeof error.code === 'string' && /^[TSL][0-9]$/.test(error.code) ? error.code : fallback
  const detail = String((error && error.message) || error || 'Unknown startup error').replace(/\s+/g, ' ').slice(0, 46)
  return 'Start failed ' + code + '\n' + detail
}
