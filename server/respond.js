// Writing a web Response onto a Node response.
//
// The one thing that needs care is Set-Cookie. setHeader replaces rather than
// appends, and a Headers object can legitimately carry several cookies — the
// sign-in reply carries two. Collapsing them silently drops whichever came
// first, which cost a working sign-in and showed no error at all.

export async function send(res, reply) {
  res.statusCode = reply.status

  for (const [name, value] of reply.headers) {
    if (name.toLowerCase() === 'set-cookie') continue
    res.setHeader(name, value)
  }

  const cookies = reply.headers.getSetCookie ? reply.headers.getSetCookie() : []
  if (cookies.length) res.setHeader('set-cookie', cookies)

  if (!reply.body) return res.end()
  res.end(Buffer.from(await reply.arrayBuffer()))
}
