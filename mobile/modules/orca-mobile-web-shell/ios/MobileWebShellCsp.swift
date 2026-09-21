enum MobileWebShellCsp {
  /// Sent as a response header on the document and nowhere else: a served document must never
  /// carry its own policy, so there is no meta tag to find and no bundle change that can relax it.
  static let header = [
    "default-src 'none'",
    "script-src 'self'",
    // React Native Web 0.21.2 injects its stylesheet at runtime with no nonce support, so the
    // Phase C page cannot paint under 'self' alone (measured: the render check under this exact
    // header). This relaxes styling only; script-src 'self' is untouched.
    "style-src 'self' 'unsafe-inline'",
    // `data:` because a file preview has no other shape: the desktop answers a base64 body and the
    // page composes `data:<mime>;base64,<content>` for React Native Web's Image. `https:` because
    // markdown and the rich editor render images the author referenced by URL; native loads those
    // already, so without it the page paints a blank where native paints the image.
    //
    // The bound is the destination, not the provenance. CSP matches both as schemes, so this admits
    // any image URL of either and cannot tell one the page composed from one it was handed; for
    // `data:` the mime type and the body are both the host's, and the page only checks the mime
    // type is a non-empty string. What holds is that the URL is never fetched as anything but an
    // image: img-src is the only directive admitting them, an image fetch executes nothing (an SVG
    // inside an <img> runs no script), and script-src 'self', connect-src 'self' and object-src
    // 'none' are untouched. What `https:` adds is a request whose target the rendered content
    // chose, reaching the sandboxed preview frame too since it inherits this policy: a document can
    // learn it was opened.
    //
    // `http:` stays out: it reaches no image TLS cannot serve, and a cleartext image is readable
    // and replaceable in flight by anything on the path.
    "img-src 'self' data: https:",
    "font-src 'none'",
    // The origin is one read-only directory behind the manifest map, so 'self' reaches nothing the
    // page cannot already read, and the bootstrap page reads ./manifest.json through it. This is
    // the fence for fetch and XMLHttpRequest; the document-start script covers only the two things
    // the native layer cannot see.
    "connect-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].joined(separator: "; ")
}
