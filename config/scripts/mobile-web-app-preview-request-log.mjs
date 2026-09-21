/**
 * What the browser said about every request to one origin, for an arm that expected one and did not
 * get it.
 *
 * Four sources, because each is blind where the others see. `request` fires for what the page asked
 * for at all, which separates a request the policy refused from one nothing ever made.
 * `requestfailed` carries the browser's own `errorText`. CDP's `Network.loadingFailed` adds
 * `blockedReason` and `corsErrorStatus`, which is the only place a refusal names itself when the
 * request never reached a route handler. `Network.requestWillBeSent` records the resource type, the
 * initiator and the frame, which separates an image the parser found from one nothing asked for.
 *
 * CDP is Chromium's; WebKit has no session to open here, and the two page events carry that engine.
 *
 * Recorded into arrays and formatted only when asked, so an arm that passes pays for the
 * subscription and never for the reading.
 */
export async function recordRequestsTo(page, originPrefix) {
  const asked = []
  const failed = []
  const sent = []
  const loadingFailed = []
  // Only this origin's ids, because `Network.loadingFailed` carries a request id and no URL, and an
  // unfiltered list would report every other request on the page as this arm's evidence.
  const ours = new Set()

  page.on('request', (request) => {
    if (request.url().startsWith(originPrefix)) {
      asked.push(request.url())
    }
  })
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(originPrefix)) {
      failed.push({ url: request.url(), errorText: request.failure()?.errorText ?? null })
    }
  })

  const cdp = await page
    .context()
    .newCDPSession(page)
    .catch(() => null)
  if (cdp) {
    await cdp.send('Network.enable').catch(() => {})
    cdp.on('Network.requestWillBeSent', (event) => {
      if (!event.request?.url?.startsWith(originPrefix)) {
        return
      }
      ours.add(event.requestId)
      sent.push({
        url: event.request.url,
        type: event.type ?? null,
        initiator: event.initiator?.type ?? null,
        frameId: event.frameId ?? null
      })
    })
    cdp.on('Network.loadingFailed', (event) => {
      if (!ours.has(event.requestId)) {
        return
      }
      loadingFailed.push({
        errorText: event.errorText ?? null,
        blockedReason: event.blockedReason ?? null,
        corsErrorStatus: event.corsErrorStatus ?? null,
        type: event.type ?? null
      })
    })
  }

  return () =>
    `asked ${JSON.stringify(asked)}; failed ${JSON.stringify(failed)}; cdp ${cdp ? 'on' : 'off'} sent ${JSON.stringify(sent)}; cdp loadingFailed ${JSON.stringify(loadingFailed)}`
}
