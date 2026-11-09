import { Accelerometer, FREQ_MODE_LOW, checkSensor } from '@zos/sensor'
import { createWidget, widget, prop, align, text_style } from '@zos/ui'
import { queryPermission, requestPermission } from '@zos/app'
import { start, stop, getAllAppServices } from '@zos/app-service'
import { setPageBrightTime, resetPageBrightTime, pauseDropWristScreenOff, resetDropWristScreenOff } from '@zos/display'
import { MotionWindow } from './activity'
import { ACTIVITIES } from '../lib/monitor'

const SERVICE = 'app-service/monitor'
const PERMISSION = 'device:os.bg_service'

Page({
  build() {
    this.shared = getApp()._options.globalData
    this.closed = this.busy = this.practice = false
    this.lastError = ''
    this.activityIndex = 0
    this.motionWindow = new MotionWindow()
    const text = (y, h, size, value, color = 0xffffff) => createWidget(widget.TEXT, {
      x: 24, y, w: 384, h, text_size: size, color, align_h: align.CENTER_H, text_style: text_style.WRAP, text: value
    })
    const button = (y, h, label, click) => createWidget(widget.BUTTON, {
      x: 30, y, w: 372, h, radius: 18, normal_color: 0x235c4d,
      press_color: 0x338065, color: 0xffffff, text_size: 23, text: label, click_func: click
    })
    text(14, 32, 25, 'Live Heart 1.2.2')
    this.value = text(50, 55, 41, '-- bpm')
    this.stepsText = text(110, 30, 24, 'Steps today: --')
    this.status = text(145, 100, 26, 'Monitoring stopped')
    this.button = button(252, 56, 'Start background monitor', () => this.toggle())
    this.activityChoice = button(315, 44, 'Choose: Tai chi', () => {
      if (this.shared.monitor && this.shared.monitor.activity) return
      this.activityIndex = (this.activityIndex + 1) % ACTIVITIES.length
      this.refresh()
    })
    this.activityButton = button(368, 44, 'Start activity label', () => this.toggleActivity())
    this.motionButton = button(421, 48, 'Start practice motion', () => this.toggleMotion())
    text(478, 30, 16, 'Pulse + steps: background', 0xa8b5c8)
    this.onMotion = () => {
      if (!this.practice) return
      try { this.motionWindow.add(this.accel.getCurrent(), Date.now() / 1000) } catch (_) {}
    }
    this.timer = setInterval(() => this.refresh(), 2000)
    this.refresh()
  },
  serviceExists() {
    try { return getAllAppServices().some(file => file === SERVICE || file === SERVICE + '.js') }
    catch (_) { return false }
  },
  fail(message) {
    this.busy = false
    this.lastError = message
    this.refresh()
  },
  refresh() {
    if (this.closed) return
    const monitor = this.shared.monitor
    const running = !!(monitor && monitor.running)
    if (this.practice && !running) this.stopPractice()
    if (this.practice) monitor.setMotion(this.motionWindow.take())
    const now = Date.now() / 1000
    const fresh = item => item && now >= item.ts && now - item.ts <= 20
    this.value.setProperty(prop.TEXT, running && fresh(monitor.heart) ? monitor.heart.bpm + ' bpm' : '-- bpm')
    this.stepsText.setProperty(prop.TEXT, running && fresh(monitor.steps) ? 'Steps today: ' + monitor.steps.count : 'Steps today: --')
    this.status.setProperty(prop.TEXT, this.lastError || (this.busy ? 'Waiting for watch service...' : monitor ? monitor.deliveryStatus() : 'Monitoring stopped'))
    const servicePresent = running || !!monitor || this.serviceExists()
    this.button.setProperty(prop.TEXT, servicePresent ? 'Stop all monitoring' : 'Start background monitor')
    const activity = monitor && monitor.activity
    const label = activity ? ACTIVITIES.find(item => item[0] === activity.label)[1] : ACTIVITIES[this.activityIndex][1]
    this.activityChoice.setProperty(prop.TEXT, (activity ? 'Label: ' : 'Choose: ') + label)
    this.activityButton.setProperty(prop.TEXT, activity ? 'End activity label' : 'Start activity label')
    this.motionButton.setProperty(prop.TEXT, this.practice ? 'Stop practice motion' : 'Start practice motion')
  },
  toggle() {
    if (this.busy) return
    this.lastError = ''
    const monitor = this.shared.monitor
    if (monitor || this.serviceExists()) {
      this.stopPractice()
      // Stop sensing immediately even if the OS service shutdown fails.
      if (monitor) monitor.stop()
      this.busy = true
      try {
        const result = stop({file: SERVICE, complete_func: ({result}) => {
          this.busy = false
          if (!result) this.lastError = 'Service stop failed; tap Stop again'
          else if (this.shared.monitor === monitor) this.shared.monitor = null
          this.refresh()
        }})
        if (result !== 0) this.fail('Service stop failed (' + result + '); tap Stop again')
      } catch (_) { this.fail('Service stop failed; tap Stop again') }
      this.refresh()
      return
    }
    this.busy = true
    try {
      if (queryPermission({permissions: [PERMISSION]})[0] === 2) return this.begin()
      const result = requestPermission({permissions: [PERMISSION], callback: values => {
        if (this.closed) return
        if (values[0] === 2) this.begin()
        else this.fail('Background permission was not granted')
      }})
      if (result === 2) this.begin()
      else if (result !== 0) this.fail('Enable background permission to start')
    } catch (_) { this.fail('Background permission unavailable') }
    this.refresh()
  },
  begin() {
    if (this.closed || this.startRequested) return
    this.startRequested = true
    try {
      const result = start({file: SERVICE, reload: true, complete_func: ({result}) => {
        this.busy = this.startRequested = false
        if (!result) this.lastError = 'Background start failed; try again'
        this.refresh()
      }})
      if (result !== 0) {
        this.startRequested = false
        this.fail('Background start failed (' + result + ')')
      }
    } catch (_) { this.startRequested = false; this.fail('Background service unavailable') }
    this.refresh()
  },
  toggleActivity() {
    const monitor = this.shared.monitor
    if (!monitor || !monitor.running) return this.fail('Start the background monitor first')
    this.lastError = ''
    monitor.setActivity(monitor.activity ? null : ACTIVITIES[this.activityIndex][0])
    this.refresh()
  },
  toggleMotion() {
    if (this.practice) { this.stopPractice(); this.refresh(); return }
    if (!this.shared.monitor || !this.shared.monitor.running) return this.fail('Start the background monitor first')
    this.lastError = ''
    try {
      if (!checkSensor(Accelerometer)) throw Error()
      this.accel = new Accelerometer()
      this.accel.setFreqMode(FREQ_MODE_LOW)
      this.accel.onChange(this.onMotion)
      this.practice = true
      this.accel.start()
      setPageBrightTime({brightTime: 3600000})
      pauseDropWristScreenOff({duration: 0})
    } catch (_) { this.stopPractice(); this.fail('Practice motion unavailable') }
    this.refresh()
  },
  stopPractice() {
    this.practice = false
    try { if (this.accel) this.accel.offChange(this.onMotion) } catch (_) {}
    try { if (this.accel) this.accel.stop() } catch (_) {}
    this.accel = null
    this.motionWindow.reset()
    if (this.shared.monitor) this.shared.monitor.setMotion(null)
    resetPageBrightTime()
    resetDropWristScreenOff()
  },
  onPause() { this.stopPractice() },
  onResume() { this.refresh() },
  onDestroy() {
    this.closed = true
    this.stopPractice()
    clearInterval(this.timer)
    // The App Service, not this page, owns continuous pulse and steps.
  }
})
