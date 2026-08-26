import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

const port = Number.parseInt(process.env.PORT || '8080', 10)
const root = path.resolve('dist')
const apiUpstream = new URL(process.env.API_UPSTREAM || 'http://backend:8080')

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function sendText(response, status, message) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(message)
}

function proxyAPI(request, response) {
  const target = new URL(request.url, apiUpstream)
  const headers = { ...request.headers, host: apiUpstream.host }
  const forwardedFor = request.socket.remoteAddress || ''
  headers['x-forwarded-for'] = headers['x-forwarded-for']
    ? `${headers['x-forwarded-for']}, ${forwardedFor}`
    : forwardedFor
  headers['x-forwarded-proto'] = 'http'

  const upstreamRequest = http.request({
    protocol: apiUpstream.protocol,
    hostname: apiUpstream.hostname,
    port: apiUpstream.port,
    method: request.method,
    path: `${target.pathname}${target.search}`,
    headers,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers)
    upstreamResponse.pipe(response)
  })
  upstreamRequest.on('error', () => {
    if (!response.headersSent) {
      sendText(response, 502, 'Bad Gateway')
    } else {
      response.destroy()
    }
  })
  request.pipe(upstreamRequest)
}

async function resolveAsset(urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const candidate = path.resolve(root, relative)
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    return null
  }
  try {
    if ((await stat(candidate)).isFile()) {
      return candidate
    }
  } catch {
    // SPA routes fall back to index.html.
  }
  return path.join(root, 'index.html')
}

const server = http.createServer(async (request, response) => {
  const requestURL = new URL(request.url || '/', 'http://frontend')
  if (requestURL.pathname.startsWith('/api/')) {
    proxyAPI(request, response)
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'Method Not Allowed')
    return
  }

  const asset = await resolveAsset(requestURL.pathname)
  if (!asset) {
    sendText(response, 400, 'Bad Request')
    return
  }
  const extension = path.extname(asset).toLowerCase()
  const isIndex = path.basename(asset) === 'index.html'
  response.writeHead(200, {
    'content-type': contentTypes[extension] || 'application/octet-stream',
    'cache-control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  const stream = createReadStream(asset)
  stream.on('error', () => response.destroy())
  stream.pipe(response)
})

server.listen(port, '0.0.0.0')
