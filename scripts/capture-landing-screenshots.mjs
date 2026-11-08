// Render the production UI with fictional data, without credentials or API calls.
// Run: node scripts/capture-landing-screenshots.mjs
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from '@playwright/test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('.runtime/landing-capture');
await mkdir(root, { recursive: true });
await mkdir(resolve('public/landing'), { recursive: true });
const accounts = [
  { id: 'demo-threads', account_name: 'NexAuto Studio', platform: 'threads' },
  { id: 'demo-x', account_name: 'NexAuto Journal', platform: 'x' },
];
const content = [
  '発信を続けるコツは、思いつきに頼らないこと。来週届けたいテーマを、今日のうちに整理しておきましょう。',
  '新しいプロジェクトの裏側をご紹介。小さな改善を重ねることで、毎日の仕事はもっとシンプルになります。',
  '「何を投稿しよう」で止まっていませんか？ お客様からよくいただく質問が、次の投稿のヒントになります。',
  '今週の振り返り。反応がよかった投稿を見直すと、読者が知りたいことが少しずつ見えてきます。',
  'ブランドの言葉を、毎日の発信へ。私たちがコンテンツづくりで大切にしている3つのこと。',
  '忙しい日も、届けたい言葉を届けるために。発信の準備をまとめて行う時間をつくっています。',
];
const posts = content.map((text, i) => ({
  id: `demo-post-${i}`,
  account_id: accounts[0].id,
  content: text,
  scheduled_date: `2026-11-${String(14 - i).padStart(2, '0')}T00:00:00Z`,
  status: ['draft', 'review', 'ready', 'published', 'published', 'published'][
    i
  ],
  source: i % 3 === 0 ? 'manual' : 'ai',
  image_url: null,
  error_message: null,
  published_at:
    i > 2 ? `2026-11-${String(14 - i).padStart(2, '0')}T00:00:00Z` : null,
  platform_post_id: null,
  created_at: '2026-11-08T00:00:00Z',
  latest_metrics:
    i > 2
      ? {
          id: `metric-${i}`,
          post_id: `demo-post-${i}`,
          impressions: [0, 0, 0, 12480, 8320, 6150][i],
          likes: 120 + i * 17,
          replies: 8 + i,
          reposts: 12 + i,
          fetched_at: '2026-11-08T00:00:00Z',
        }
      : null,
}));
await writeFile(
  resolve(root, 'index.html'),
  '<html lang="ja"><head><meta charset="UTF-8"></head><body style="margin:0"><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>',
);
await writeFile(
  resolve(root, 'next-stubs.tsx'),
  `import React from 'react'; export default function Link({href, children, priority, ...props}) {return <a href={href} {...props}>{children}</a>}; export const usePathname=()=>location.pathname; export const useRouter=()=>({push(){},refresh(){}});`,
);
await writeFile(
  resolve(root, 'image.tsx'),
  `import React from 'react';export default function Image({priority, ...props}){return <img {...props}/>}`,
);
await writeFile(
  resolve(root, 'entry.tsx'),
  `
import React from 'react'; import {createRoot} from 'react-dom/client';
import '../../src/app/globals.css';
import {Sidebar} from '../../src/components/dashboard/sidebar';
import {PostsTable} from '../../src/components/posts/PostsTable';
import {MetricsView} from '../../src/components/analytics/MetricsView';
const accounts=${JSON.stringify(accounts)};const posts=${JSON.stringify(posts)};
const analytics=location.pathname==='/app/analytics';
createRoot(document.getElementById('root')!).render(<div style={{fontFamily:'Arial, sans-serif'}} className="flex min-h-screen"><Sidebar role="admin"/><main className="flex-1 bg-gray-50 p-6 min-w-0"><h1 className="text-xl font-semibold mb-6">{analytics?'分析':'投稿管理'}</h1>{analytics?<MetricsView accounts={accounts} initialPosts={posts.filter(p=>p.status==='published')}/>:<PostsTable accounts={accounts} initialPosts={posts} isAdmin/>}</main></div>);
`,
);
const server = await createServer({
  configFile: false,
  root,
  publicDir: resolve('public'),
  define: {
    'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(
      'https://demo.supabase.co',
    ),
    'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify('demo-only'),
  },
  css: { postcss: resolve('.') },
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve('src'),
      'next/link': resolve(root, 'next-stubs.tsx'),
      'next/navigation': resolve(root, 'next-stubs.tsx'),
      'next/image': resolve(root, 'image.tsx'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4318,
    strictPort: true,
    fs: { allow: [resolve('.')] },
  },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 840 },
    deviceScaleFactor: 1,
    timezoneId: 'Asia/Tokyo',
  });
  const failures = [];
  page.on('pageerror', (e) => failures.push(e.message));
  await page.route('**/api/**', (route) => route.abort());
  for (const screen of ['posts', 'analytics']) {
    await page.goto(`http://127.0.0.1:4318/app/${screen}`);
    await page
      .getByRole('heading', {
        name: screen === 'posts' ? '投稿管理' : '分析',
        exact: true,
      })
      .waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(`public/landing/${screen}.png`) });
  }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(
    'Captured production PostsTable, MetricsView and Sidebar with fictional sample data.',
  );
} finally {
  await browser?.close();
  await server.close();
  await rm(root, { recursive: true, force: true });
}
