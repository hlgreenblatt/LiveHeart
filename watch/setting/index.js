import { settingText, validateEndpoint } from '../app-side/relay'

AppSettingsPage({
  build(props) {
    const read = key => settingText(props.settingsStorage.getItem(key))
    const save = (key, value) => props.settingsStorage.setItem(key, settingText(value))
    return Section({}, [
      Text({}, ['Live Heart 1.2.3 — background monitor']),
      Text({}, ['On your WATCH, start the background monitor and allow background access. Pulse and steps can then continue at the clock face. Practice motion needs its screen open.']),
      TextInput({label: 'Bridge address', value: read('bridge_url'),
        onChange: value => {
          let address = settingText(value)
          try { address = validateEndpoint(address) } catch (_) {}
          save('bridge_url', address)
        },
        placeholder: 'http://192.168.x.x:18962'}),
      Text({}, ['Saved address: ' + (read('bridge_url') || '(not saved yet)')]),
      Button({label: 'Test connection from Zepp', onClick: () => {
        props.settingsStorage.setItem('connection_status', 'Testing Zepp connection...')
        props.settingsStorage.setItem('check_request', String(Date.now()))
      }}),
      Text({}, [read('connection_status') || 'Connection test result appears here.']),
      Text({}, ['Already paired? Leave pairing alone. This connection test does not prove watch readings are arriving.']),
      TextInput({label: 'One-time pairing code', value: read('pair_code'),
        onChange: value => save('pair_code', value),
        placeholder: '8 digits shown on your computer'}),
      Text({}, ['Pairing code saved: ' + read('pair_code').replace(/[\s-]/g, '').length + ' digits']),
      Button({label: 'Pair with my computer', onClick: () => {
        props.settingsStorage.setItem('pair_status', 'Pairing...')
        props.settingsStorage.setItem('pair_request', String(Date.now()))
      }}),
      Text({}, [props.settingsStorage.getItem('pair_status') || 'Not paired yet']),
      Text({}, ['Use the same trusted network as your receiver. Guest Wi-Fi may block access. Computer Ethernet is fine.'])
    ])
  }
})
