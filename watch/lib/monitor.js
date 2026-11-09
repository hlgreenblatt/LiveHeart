import { StepSession, snapshot } from '../page/activity'
import { validTimerHandle, requireTimerHandle, timerFailure } from './native-timers'

export const SEND_INTERVAL_MS = 5000
export const ACTIVITIES = [
  ['tai_chi', 'Tai chi'], ['yoga', 'Yoga'], ['tantra', 'Tantra'],
  ['mowing', 'Mowing'], ['shoveling', 'Shoveling'], ['walking', 'Walking']
]
export const ACTIVITY_LIMIT_SECONDS = 4 * 3600

function linkError(error) {
  const codes = {
    1: 'Open Zepp on your phone', 2: 'Watch disconnected from phone',
    3: 'Reopen Zepp on your phone', 4: 'Phone reply timed out; check Zepp and Wi-Fi'
  }
  return codes[error && error.code] || 'Phone link failed; open Zepp and retry'
}

// The service owns this controller. Closing a page must not stop its sensors.
export class Monitor {
  constructor({heartRate, step, request, connected, createTimer, stopTimer, now = () => Date.now()}) {
    Object.assign(this, {heartRate, step, request, connected, createTimer, stopTimer, now})
    this.running = false
    this.message = 'Monitoring stopped'
    this.activity = null
    this.heart = this.steps = this.motion = null
    this.lastAck = 0
    this.onHeart = () => {
      if (!this.running) return
      try {
        const bpm = this.heartRate.getCurrent()
        if (Number.isInteger(bpm) && bpm > 0 && bpm <= 300) this.heart = {ts: this.now() / 1000, bpm}
      } catch (_) {}
    }
  }
  start() {
    if (this.running) return
    this.running = true
    this.startedAt = this.now() / 1000
    this.heart = this.steps = this.motion = this.activity = this.inflight = null
    this.lastAck = 0
    const timerRun = {}
    this.timerRun = timerRun
    this.timerTicks = 0
    this.lastTimerTick = this.now()
    this.message = 'Starting sensors'
    this.stepSession = new StepSession(this.startedAt)
    try { if (this.heartRate) this.heartRate.onCurrentChange(this.onHeart) } catch (_) {}
    try {
      if (typeof this.createTimer !== 'function' || typeof this.stopTimer !== 'function') {
        throw timerFailure('T0', 'System timer API unavailable')
      }
      this.timer = this.createTimer(true, SEND_INTERVAL_MS, () => {
        if (!this.running || this.timerRun !== timerRun) return
        this.timerTicks++
        this.lastTimerTick = this.now()
        this.collect()
      })
      requireTimerHandle(this.timer)
    } catch (error) {
      this.stop()
      throw error && error.code ? error : timerFailure('T1', String((error && error.message) || error))
    }
    this.collect()
  }
  setActivity(label) {
    if (!this.running) return
    const now = this.now() / 1000
    if (label !== null && !ACTIVITIES.some(item => item[0] === label)) throw Error('Unknown activity')
    this.activity = label === null ? null : {
      label, source: 'user', started_at: now, expires_at: now + ACTIVITY_LIMIT_SECONDS,
      session_id: 'watch-' + this.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
    }
    this.stepSession = new StepSession(now)
    this.steps = null
    // The next periodic sample carries the label; no duplicate-timestamp send.
  }
  setMotion(value) { this.motion = value }
  collect() {
    if (!this.running) return
    const now = this.now() / 1000
    if (this.activity && (now >= this.activity.expires_at || now < this.activity.started_at)) this.setActivity(null)
    try { this.steps = this.step ? this.stepSession.observe(this.step.getCurrent(), now) : null }
    catch (_) { this.steps = null }
    const sample = snapshot(now, this.heart, this.steps, this.motion)
    if (!sample) { this.message = 'Waiting for fresh sensor readings'; return }
    sample.schema = 4
    sample.context = {monitor_started_at: this.startedAt,
      mode: sample.motion ? 'practice' : 'background', activity: this.activity}
    if (this.inflight) return // Native transport timers settle failed requests.
    let connected
    try { connected = this.connected() }
    catch (_) { this.message = 'Link check failed L0'; return }
    if (!connected) { this.message = 'Watch disconnected from phone'; return }
    const flight = {ts: sample.ts}
    this.inflight = flight
    Promise.resolve().then(() => {
      if (!this.running || this.inflight !== flight) return null
      return this.request({method: 'sample', params: sample}, {timeout: 12000})
    }).then(result => {
      if (!this.running || this.inflight !== flight) return
      if (result && result.ok && result.accepted_ts === flight.ts) {
        this.lastAck = this.now()
        this.message = 'Computer received readings'
      } else this.message = String((result && result.error) || 'Computer did not confirm receipt').slice(0, 100)
    }).catch(error => {
      if (this.running && this.inflight === flight) {
        this.message = error && /^T[0-9]$/.test(error.code) ?
          error.code + ': ' + String(error.message).slice(0, 50) : linkError(error)
      }
    }).finally(() => { if (this.inflight === flight) this.inflight = null })
  }
  deliveryStatus() {
    if (this.running && this.now() - this.lastTimerTick >= SEND_INTERVAL_MS * 4) {
      return 'Timer not firing T3'
    }
    if (this.running && this.timerTicks === 0 && this.message === 'Computer received readings') {
      return 'Waiting for timer tick'
    }
    if (!this.running || !this.lastAck || this.message !== 'Computer received readings') return this.message
    const age = Math.floor((this.now() - this.lastAck) / 1000)
    if (age < 0) return 'Watch clock changed; awaiting new delivery'
    return age <= 20 ? 'Delivered ' + age + 's ago' : 'No delivery for ' + age + 's; check Zepp and Wi-Fi'
  }
  stop() {
    this.running = false
    this.inflight = null
    this.timerRun = null
    if (validTimerHandle(this.timer)) { try { this.stopTimer(this.timer) } catch (_) {} }
    this.timer = undefined
    try { if (this.heartRate) this.heartRate.offCurrentChange(this.onHeart) } catch (_) {}
    this.heart = this.steps = this.motion = this.activity = null
    this.message = 'Monitoring stopped'
  }
}
