import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { verifyAsset } from '../packages/mcp-server/dist/publishing/assets.js'

const bytes = await readFile(process.argv[2])
const asset = {
  id: 'fixture',
  company_id: 'fixture-company',
  object_path: 'fixture/video.mp4',
  kind: 'video',
  status: 'uploading',
  size_bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}
let stored = false
const db = {
  from: () => {
    const query = {
      select: () => query,
      eq: () => query,
      single: async () => ({ data: asset, error: null }),
      update: (value) => {
        stored = value.status === 'verified'
        return query
      },
      then: (resolve) => resolve({ error: null }),
    }
    return query
  },
  storage: {
    from: () => ({
      createSignedUrl: async () => ({
        data: { signedUrl: 'https://fixture.invalid/video' },
        error: null,
      }),
    }),
  },
}
globalThis.fetch = async () => new Response(bytes)
const result = await verifyAsset(
  db,
  { companyId: 'fixture-company', actorId: 'fixture-admin', source: 'mcp' },
  asset.id,
)
if (result.status !== 'verified' || !stored)
  throw new Error('Video verification did not finish')
console.log(
  'Real MP4 stream, SHA-256, codec, duration, and frame-rate validation passed.',
)
