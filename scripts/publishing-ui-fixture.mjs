import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdir, writeFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('.runtime/publishing-ui')
await mkdir(root, { recursive: true })
const imageFile = process.argv[2]
if (imageFile) await copyFile(imageFile, resolve(root, 'fixture.jpg'))
const account = {
  id: 'fixture-account',
  account_name: 'Dober test',
  platform: 'threads',
  connection_status: 'connected',
  token_expires_at: null,
}
const post = {
  id: 'fixture-post',
  account_id: account.id,
  content: 'Local UI fixture. No social platform is called.',
  status: 'draft',
  asset_id: null,
  execution_at: null,
}
const snapshot = {
  ...post,
  post_id: post.id,
  revision: 1,
  account_name: account.account_name,
  platform: 'threads',
  platform_user_id: 'fixture-user',
  asset: imageFile
    ? {
        id: 'fixture-image',
        path: 'fixture.jpg',
        kind: 'image',
        sha256: 'b'.repeat(64),
      }
    : null,
  cover: null,
  image_url: null,
  share_to_feed: true,
  is_ai_generated: false,
}
let approved = false
let dispatched = 0
let lastJob = null
await writeFile(
  resolve(root, 'index.html'),
  '<html><head><title>NexAuto local publishing test</title></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>',
)
await writeFile(
  resolve(root, 'entry.tsx'),
  `import '../../src/app/globals.css';import React from 'react';import {createRoot} from 'react-dom/client';import {PublishingPanel} from '../../src/app/(dashboard)/publishing/publishing-panel';createRoot(document.getElementById('root')!).render(<PublishingPanel accounts={${JSON.stringify([account])}} initialPosts={${JSON.stringify([post])}} initialJobs={[]} />);`,
)
const fixture = {
  name: 'publishing-test-api',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/')) return next()
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = raw ? JSON.parse(raw) : {}
      let response
      if (req.url === '/api/publishing') {
        if (body.action === 'asset-preview') response = { url: '/fixture.jpg' }
        else if (body.action === 'preview')
          response = { snapshot, digest: 'a'.repeat(64) }
        else if (
          body.action === 'approve' &&
          body.digest === 'a'.repeat(64) &&
          body.instruction
        ) {
          approved = true
          lastJob = {
            id: 'fixture-job',
            post_id: post.id,
            state: 'queued',
            run_at: new Date().toISOString(),
            permalink: null,
            error_code: null,
          }
          response = lastJob
        } else if (body.action === 'run' && approved) {
          dispatched++
          lastJob = {
            ...lastJob,
            state: 'published',
            platform_post_id: 'fixture-media',
            permalink: 'https://www.threads.com/@fixture/post/test',
          }
          response = lastJob
        } else if (body.action === 'status') response = lastJob
      } else if (req.url === '/api/posts')
        response = { ...post, id: 'new-fixture-post', content: body.content }
      else if (req.url === '/api/test-results')
        response = { approved, dispatched }
      res.setHeader('Content-Type', 'application/json')
      if (!response) {
        res.statusCode = 400
        response = { error: 'fixture_rejected' }
      }
      res.end(JSON.stringify(response))
    })
  },
}
const server = await createServer({
  configFile: false,
  define: { 'process.env': {} },
  css: { postcss: resolve('.') },
  root,
  plugins: [react(), fixture],
  resolve: { alias: { '@': resolve('src') } },
  server: {
    host: '127.0.0.1',
    port: 4317,
    strictPort: true,
    fs: { allow: [resolve('.')] },
  },
})
await server.listen()
console.log('Local UI fixture at http://127.0.0.1:4317. No platform API calls.')
