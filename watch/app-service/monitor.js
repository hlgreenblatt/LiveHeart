import { HeartRate, Step, checkSensor } from '@zos/sensor'
import { connectStatus } from '@zos/ble'
import { createSysTimer, stopTimer } from '@zos/timer'
import { Monitor } from '../lib/monitor'
import { readableFailure } from '../lib/native-timers'

function sensor(Type) {
  try { return checkSensor(Type) ? new Type() : null } catch (_) { return null }
}

AppService({
  onInit() {
    const shared = getApp()._options.globalData
    this.monitor = new Monitor({heartRate: sensor(HeartRate), step: sensor(Step),
      request: (request, options) => shared.messaging.request(request, options),
      connected: () => connectStatus(),
      createTimer: typeof createSysTimer === 'function' ? (...args) => createSysTimer(...args) : undefined,
      stopTimer: typeof stopTimer === 'function' ? id => stopTimer(id) : undefined})
    shared.monitor = this.monitor
    try { this.monitor.start() }
    catch (error) {
      this.monitor.stop()
      this.monitor.message = readableFailure(error)
    }
  },
  onDestroy() {
    if (this.monitor) this.monitor.stop()
    const shared = getApp()._options.globalData
    if (shared.monitor === this.monitor) shared.monitor = null
  }
})
