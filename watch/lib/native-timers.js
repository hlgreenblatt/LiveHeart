// Zepp documents numeric IDs, but the Bip Max reported typeof handle === 'object'.
// Preserve non-null objects without inspecting/coercing them; null is a failure.
// Logical positive IDs protect ZML's truthy checks; native handles stay private.
export function timerFailure(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function validTimerHandle(id) {
  return (typeof id === 'number' && Number.isFinite(id)) ||
    (id !== null && typeof id === 'object')
}

export function requireTimerHandle(id) {
  if (validTimerHandle(id)) return id
  const kind = id === null ? 'null' : typeof id
  throw timerFailure('T2', 'Timer unavailable (' + kind + ')')
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
      const entry = {active: true, native: undefined}
      try {
        entry.native = api.createSysTimer(false, delay, () => {
          if (!entry.active) return
          entry.active = false
          handles.delete(logical)
          callback()
        })
      } catch (e) {
        entry.active = false
        throw timerFailure('T1', String((e && e.message) || e || 'Native timer call failed'))
      }
      try { requireTimerHandle(entry.native) }
      catch (e) { entry.active = false; throw e }
      if (entry.active) handles.set(logical, entry)
      return logical
    },
    clearTimeout(logical) {
      if (!handles.has(logical)) return
      const entry = handles.get(logical)
      entry.active = false
      handles.delete(logical)
      api.stopTimer(entry.native)
    }
  }
}

export function readableFailure(error, fallback = 'S0') {
  const code = error && typeof error.code === 'string' && /^[TSL][0-9]$/.test(error.code) ? error.code : fallback
  const detail = String((error && error.message) || error || 'Unknown startup error').replace(/\s+/g, ' ').slice(0, 46)
  return 'Start failed ' + code + '\n' + detail
}
