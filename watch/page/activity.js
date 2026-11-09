// Constant-memory summaries; no raw motion history is retained.
const round = value => Math.round(value * 100) / 100

export class MotionWindow {
  constructor() { this.reset() }
  reset() {
    this.n = 0
    this.mean = [0, 0, 0]
    this.m2 = [0, 0, 0]
    this.previous = null
    this.peak = 0
    this.start = 0
    this.end = 0
  }
  add(axes, ts) {
    if (!axes || !Number.isFinite(ts) || ts <= 0) return
    const values = [axes.x, axes.y, axes.z]
    if (!values.every(value => Number.isFinite(value) && Math.abs(value) <= 100000)) return
    // A suspended app or clock reset starts a new window, not a fake long average.
    if (this.n && (ts < this.end || ts - this.start > 10 || this.n >= 10000)) this.reset()
    if (!this.n) this.start = ts
    this.n++
    if (this.previous) {
      const delta = values.map((value, i) => value - this.previous[i])
      this.peak = Math.max(this.peak, Math.sqrt(delta.reduce((sum, x) => sum + x * x, 0)))
    }
    values.forEach((value, i) => {
      const delta = value - this.mean[i]
      this.mean[i] += delta / this.n
      this.m2[i] += delta * (value - this.mean[i])
    })
    this.previous = values
    this.end = ts
  }
  take() {
    let result = null
    if (this.n >= 2 && this.end > this.start) {
      result = {
        ts: this.end, window_start: this.start, samples: this.n,
        rms_variation_cm_s2: round(Math.sqrt(Math.max(0, this.m2.reduce((sum, x) => sum + x, 0) / this.n))),
        peak_change_cm_s2: round(this.peak),
        x: round(this.previous[0]), y: round(this.previous[1]), z: round(this.previous[2])
      }
    }
    this.reset()
    return result
  }
}

export class StepSession {
  constructor(startedAt) {
    this.startedAt = startedAt
    this.previous = null
    this.total = 0
  }
  observe(count, ts) {
    if (!Number.isInteger(count) || count < 0 || count > 1000000 || !Number.isFinite(ts) || ts < this.startedAt) return null
    // Midnight or a counter reset establishes a new baseline.
    if (this.previous !== null && count >= this.previous) this.total += count - this.previous
    this.previous = count
    return {ts, count, since_start: this.total, session_started_at: this.startedAt}
  }
}

export function snapshot(now, heart, steps, motion) {
  const packet = {schema: 3, source: 'zepp-watch', ts: now}
  for (const [name, value] of [['heart_rate', heart], ['steps', steps], ['motion', motion]]) {
    if (value && value.ts <= now && now - value.ts <= 15) packet[name] = value
  }
  return Object.keys(packet).length > 3 ? packet : null
}
