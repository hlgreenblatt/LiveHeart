# Third-party components

`watch/lib/zml-app.js` derives from `@zeppos/zml` version 0.0.43 and retains its
upstream attribution. Its Apache License 2.0 text is included at
`watch/lib/ZML-LICENSE.txt`.

Local modifications use native system timers for background messaging, preserve
opaque timer handles through a logical-ID adapter, ignore late responses and
cancel pending requests on disconnect. The phone side service imports
`@zeppos/zml/base-side` from the version pinned in `watch/package.json`.

Zepp OS and Amazfit product names identify the platform and tested hardware.
This project is independently developed.
