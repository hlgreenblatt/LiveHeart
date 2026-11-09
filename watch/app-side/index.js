import { BaseSideService } from '@zeppos/zml/base-side'
import { relaySample, pairBridge, checkBridge } from './relay'

AppSideService(BaseSideService({
  async onSettingsChange({key}) {
    if (key !== 'pair_request' && key !== 'check_request') return
    try {
      const readSetting = name => settings.settingsStorage.getItem(name)
      if (key === 'check_request') {
        const status = await checkBridge(readSetting, options => this.fetch(options))
        settings.settingsStorage.setItem('connection_status', status)
        return
      }
      const token = await pairBridge(readSetting, options => this.fetch(options))
      settings.settingsStorage.setItem('bridge_key', token)
      settings.settingsStorage.setItem('pair_code', '')
      settings.settingsStorage.setItem('pair_status', 'Paired. Start the background monitor on the watch.')
    } catch (e) {
      settings.settingsStorage.setItem(key === 'check_request' ? 'connection_status' : 'pair_status', e.message || 'Request failed before completion.')
    }
  },
  async onRequest(req, res) {
    if (req.method !== 'sample') return res(null, {ok: false, error: 'Unknown request'})
    try {
      const result = await relaySample(req.params,
        key => settings.settingsStorage.getItem(key), options => this.fetch(options))
      res(null, result)
    } catch (e) {
      // Do not log the request, readings, or bridge key.
      res(null, {ok: false, error: String(e.message || 'Phone cannot reach bridge').slice(0, 100)})
    }
  }
}))
