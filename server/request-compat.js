// src/worker.js forwards an incoming request's body straight into a new
// Request when it hands work to a store. Workers accepts that; Node refuses a
// stream body unless the init also says `duplex: 'half'`. Defaulting it here
// keeps the Worker file identical in both places — and the failure it fixes
// was silent, because the webhook sink answers 200 even when storing fails.

const Base = globalThis.Request

class NodeCompatRequest extends Base {
  constructor(input, init) {
    const body = init && init.body
    const isStream = body && typeof body === 'object' && typeof body.getReader === 'function'
    if (isStream && init.duplex === undefined) init = { ...init, duplex: 'half' }
    super(input, init)
  }
}

globalThis.Request = NodeCompatRequest
