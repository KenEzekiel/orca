/**
 * When a preview-frame arm may read its counters.
 *
 * Three moments an arm can be waiting for -- the artifact parsing inside the frame, the inline
 * script running, the frame's own policy refusal -- and the two shapes of settling that follow: an
 * arm expecting a navigation waits for the record, an arm expecting none takes a bounded wait.
 * Split out of the render check because it is rig mechanics carrying no assertion, and it belongs
 * beside the diagnosis module it reports through.
 */

import { describePreviewFrame, untilAborted } from './mobile-web-app-preview-frame-diagnosis.mjs'

/**
 * The mounted frame, once it holds the artifact.
 *
 * Found by its element, never by its URL. A `srcdoc` frame reports `about:srcdoc` on both engines
 * here and an empty URL on CI's browser, and a poll that waited for the string spent every case's
 * whole timeout there -- seven timeouts on one engine, after the same difference had already shown
 * up as `expected '' to be 'about:srcdoc'`.
 *
 * Three things still settle at their own moments: React commits the mount, the element's `srcdoc`
 * commits a document, and an override arm replaces that document with a second one. So readiness is
 * the fixture's own marker inside the frame, which exists only once the artifact has parsed there.
 *
 * `frameReady` is which of those an arm is waiting for, because the marker is not always the right
 * one. `'script'` waits for what the inline script writes: the marker element exists from parse
 * time, so an arm whose oracle is "the script ran" would otherwise read `window.__ran` before it
 * had. `'refusal'` waits for the frame's own `script-src` violation, which is queued and can land
 * after `load`. `'images'` waits for the two admitted image requests to have been recorded, for the
 * arms whose claim is that they were. `'load'` is for the one arm whose artifact deliberately
 * navigates the frame somewhere else, where no marker is ever coming.
 */
export async function waitForLoadedFrame(
  page,
  { frameReady = 'artifact', signal, browserVersion, arm, readImageHits }
) {
  const element = await page.waitForSelector('iframe', { timeout: 0 })
  const frame = await element.contentFrame()
  if (!frame) {
    return null
  }
  await frame.waitForLoadState('load').catch(() => {})
  if (frameReady === 'script') {
    await untilAborted(
      frame.waitForFunction(() => window.__ran === 1, undefined, { timeout: 0 }),
      signal,
      async () =>
        `the artifact's script never ran inside the frame: ${arm} | ${await describePreviewFrame(page, frame, browserVersion)}`
    )
  }
  if (frameReady === 'refusal') {
    // The violation is dispatched as a queued task, so its order against the frame's `load` is not
    // guaranteed: on the runner's Chrome the list held only the blocked background image when the
    // reading was taken, and the arm that needs the script-src entry read it before it landed. So
    // the arm waits for its own evidence rather than hoping to be later than a task queue. A frame
    // that was never widened never raises it at all, which is what makes this the arm's precondition
    // and not a convenience: the wait ends in the diagnosis below rather than in a passing read.
    await untilAborted(
      frame.waitForFunction(
        () => (window.__violations ?? []).some((one) => String(one).includes('script-src')),
        undefined,
        { timeout: 0 }
      ),
      signal,
      async () =>
        `the frame never reported a script-src refusal: ${arm} | ${await describePreviewFrame(page, frame, browserVersion)}`
    )
  }
  if (frameReady !== 'load') {
    await untilAborted(
      frame.waitForSelector('#marker', { state: 'attached', timeout: 0 }),
      signal,
      async () =>
        `the artifact never parsed inside the frame: ${arm} | ${await describePreviewFrame(page, frame, browserVersion)}`
    )
  }
  // After the marker, because an image is requested by a document that has parsed.
  if (frameReady === 'images') {
    await untilAborted(
      untilImagesRecorded(page, readImageHits),
      signal,
      async () => await describeAdmittedImages(page, frame, readImageHits, browserVersion, arm)
    )
  }
  return frame
}

/** The two the policy admits; the font beside them is the absence these two presences hold up. */
const ADMITTED_IMAGE_PATHS = ['/css-bg.png', '/img.png']

/**
 * Both admitted image requests, once the rig has recorded them.
 *
 * Polled in Node because that is where the route handler records; the arm hands its own reader in,
 * so this module keeps no arm's state. Never rejects: once the case is over the page goes, and a
 * rejection raised then has nobody left to catch it.
 *
 * Why a wait rather than the bounded settle the arms used to take. "Two frames and 200 ms" is an
 * absence-shaped read, and these arms claim a presence. The runner's Chrome 152 had recorded the
 * CSS background and not the `<img>` when that clock expired -- a request that was slow, which the
 * count alone cannot tell from one the policy refused.
 */
async function untilImagesRecorded(page, readImageHits) {
  const missing = () => ADMITTED_IMAGE_PATHS.filter((one) => !readImageHits().includes(one))
  while (missing().length > 0) {
    const stillPolling = await page.waitForTimeout(10).then(
      () => true,
      () => false
    )
    if (!stillPolling) {
      return
    }
  }
}

/**
 * Why the images are not both there yet, read from the element the browser would have fetched for.
 *
 * `complete` with a zero `naturalWidth` is a request that finished and produced no image, which is
 * what a refusal looks like from the element; `complete` false is one still in flight. `currentSrc`
 * separates both from an element the document never resolved a URL for, and `loading` from one the
 * browser deferred on purpose. Without these a CI log says only that a count was 1.
 */
async function describeAdmittedImages(page, frame, readImageHits, browserVersion, arm) {
  const image = frame
    ? await frame
        .evaluate(() => {
          const element = document.getElementById('remote')
          return element
            ? {
                complete: element.complete,
                naturalWidth: element.naturalWidth,
                currentSrc: element.currentSrc,
                loading: element.getAttribute('loading')
              }
            : null
        })
        .catch((error) => `the reading itself failed: ${String(error).split('\n')[0]}`)
    : null
  const frameReading = await describePreviewFrame(page, frame, browserVersion)
  return `the arm recorded ${JSON.stringify(readImageHits())} of ${JSON.stringify(ADMITTED_IMAGE_PATHS)}; #remote ${JSON.stringify(image)}: ${arm} | ${frameReading}`
}

/**
 * Where an arm's counters are read: after the thing it is about, whatever that thing is.
 *
 * `expectNavigation` names what the arm is waiting for, and an arm that expects one waits for the
 * record itself rather than for a clock. An arm that expects none has nothing to await, so it takes
 * the bounded path below.
 */
export async function settleAfterMount(page, navigations, expectNavigation, signal, reading) {
  if (expectNavigation === 'main-frame') {
    return await waitForRecordedNavigation(page, navigations, (one) => one.main, signal, reading)
  }
  if (expectNavigation === 'frame') {
    return await waitForRecordedNavigation(
      page,
      navigations,
      (one) => !one.main && !one.foreign,
      signal,
      reading
    )
  }
  return await settleWithoutNavigation(page)
}

/**
 * The moment the arm's navigation exists, for an arm that expects one.
 *
 * No clock at all: the route handler above records a main-frame navigation as the browser dispatches
 * it, so the oracles are read after the thing under test rather than after a wait, and the only
 * bound is the case's own timeout through `ctx.signal`. An arm whose click missed its target prints
 * what it did record and lets the case fail as the timeout it is.
 *
 * Measured, so it is not sold as more than it is: with this replaced by a no-op every arm still
 * passes, because the reads that follow are each a round trip and the record lands during them. It is
 * the load the CI runner was under that this is for, which is the same condition that produced the
 * frame-commit race above.
 */
async function waitForRecordedNavigation(page, navigations, matches, signal, reading) {
  // Sampled while waiting, for the same reason `untilAborted` samples: a reading taken at the abort
  // can lose its race with vitest's teardown and never reach the log.
  let latest = 'no reading was taken before the case ended'
  let since = Date.now()
  while (!navigations.some((one) => matches(one))) {
    if (signal?.aborted) {
      console.error(
        `[html-preview-render] the arm produced no navigation of the kind it expects; recorded ${JSON.stringify(navigations)}: ${reading?.arm ?? 'arm unknown'} | ${latest}`
      )
      return
    }
    if (Date.now() - since > 5000) {
      since = Date.now()
      latest = await describePreviewFrame(page, reading?.frame, reading?.browserVersion).catch(
        (error) => `the reading itself failed: ${String(error).split('\n')[0]}`
      )
    }
    await page.waitForTimeout(10)
  }
}

/**
 * Where an absence is read, for the arms that expect no navigation at all.
 *
 * Nothing signals "the tap produced nothing", so this one is bounded rather than awaited. Two painted
 * frames inside the page come first: by the second, a navigation the click started has been dispatched
 * and would already be in the list the arms above read. The 200 ms after it is for the popup queue,
 * which is a browser-process event with no in-page counterpart to await.
 *
 * What keeps these absences honest is not the length of that wait: the arms that read 1 on the same
 * counters take the path above, so a counter that had stopped counting reds there.
 */
async function settleWithoutNavigation(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
  await page.waitForTimeout(200)
}
