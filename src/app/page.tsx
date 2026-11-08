import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  BarChart3,
  CalendarClock,
  Check,
  Layers3,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import { NexAutoLogo } from '@/components/brand/logo';
import styles from './landing.module.css';

export const metadata: Metadata = {
  title: 'NexAuto | SNS運用を、次のステージへ。',
  description:
    'AIで投稿案をつくり、レビューして予約投稿。反応を分析して次の発信へ。NexAutoは、SNS運用をひとつにつなぐプラットフォームです。',
  openGraph: {
    title: 'NexAuto | SNS運用を、次のステージへ。',
    description: 'つくる、届ける、振り返る。日々のSNS運用をひとつの場所で。',
    locale: 'ja_JP',
    type: 'website',
  },
};

const features = [
  {
    icon: Sparkles,
    title: 'AIが、発信の下準備を。',
    text: 'アカウントごとの方針や参考情報をもとに、1週間分の投稿案を生成。ゼロから考える時間を、内容を磨く時間へ。',
    label: 'AI CONTENT',
  },
  {
    icon: CalendarClock,
    title: '確認して、予定どおりに。',
    text: '下書き、レビュー、投稿待ちの状態を一覧で管理。内容と予約日時を確認しながら、チームで発信を進められます。',
    label: 'SCHEDULING',
  },
  {
    icon: BarChart3,
    title: '反応が、次のヒントに。',
    text: '表示回数、いいね、リポスト、リプライを投稿ごとに確認。アカウントを切り替えながら、発信の手応えを振り返れます。',
    label: 'ANALYTICS',
  },
];
const faqs = [
  [
    'どのSNSに対応していますか？',
    'Threads・Xの投稿管理、AIによる投稿案の作成、効果分析に対応しています。Instagram・Threads向けには、画像・動画と投稿内容を確認して承認する投稿機能も用意しています。利用できる機能はSNSやアカウントの設定によって異なります。',
  ],
  [
    'AIが作成した投稿は、そのまま公開されますか？',
    'AIで生成した投稿案は下書きとして保存されます。内容を確認・編集し、投稿待ちへ進める運用ができます。Instagram・Threadsの承認付き投稿では、プレビューを確認してから公開を承認します。',
  ],
  [
    '複数のアカウントを管理できますか？',
    'はい。アカウントを切り替えて投稿や分析を確認できます。企業ごとの管理と、管理者・運用担当者の役割に応じたアクセス制御にも対応しています。',
  ],
  [
    '料金や導入方法について教えてください。',
    '現在、外部提供に向けて準備を進めています。料金プラン・申込方法は、提供開始時にご案内予定です。',
  ],
];
export default function Home() {
  return (
    <div className={styles.landing}>
      <a className={styles.skip} href="#main">
        本文へ移動
      </a>
      <header className={styles.header}>
        <Link href="/" aria-label="NexAuto トップ">
          <NexAutoLogo width={144} priority />
        </Link>
        <nav aria-label="メインナビゲーション" className={styles.nav}>
          <a href="#features">特徴</a>
          <a href="#screens">実際の画面</a>
          <a href="#faq">よくある質問</a>
        </nav>
        <Link href="/app" className={styles.login}>
          ログイン <ArrowRight size={15} />
        </Link>
      </header>
      <main id="main">
        <section className={styles.hero}>
          <div className={styles.heroTop}>
            <div>
              <p className={styles.eyebrow}>
                <span /> YOUR NEXT SOCIAL WORKFLOW
              </p>
              <h1>
                SNS運用を、
                <br />
                次のステージへ<span className={styles.period}>。</span>
              </h1>
            </div>
            <div className={styles.heroIntro}>
              <p>
                つくる、届ける、振り返る。
                <br />
                日々の発信を、ひとつの流れに。
              </p>
              <p className={styles.muted}>
                AIによる投稿案の作成から、予約投稿、効果分析まで。
                <br className={styles.desktopBreak} />
                NexAutoが、続けられるSNS運用を支えます。
              </p>
              <a href="#screens" className={styles.primary}>
                実際の画面を見る <ArrowDown size={17} />
              </a>
            </div>
          </div>
          <div className={styles.heroImage}>
            <div className={styles.previewBar}>
              <span>
                <i />
                <i />
                <i />
              </span>
              <span>NexAuto — 投稿管理</span>
              <span className={styles.previewTag}>PRODUCT PREVIEW</span>
            </div>
            <Image
              src="/landing/posts.png"
              alt="NexAutoの投稿管理画面。アカウント別の投稿一覧、予約日時、レビュー状態、投稿の反応を一画面で確認できます。"
              width={1440}
              height={840}
              priority
              sizes="(max-width: 768px) 100vw, 1200px"
            />
          </div>
          <div className={styles.heroCaption}>
            <span>
              実際のアプリ画面です。表示内容・数値はサンプルデータです。
            </span>
            <span>LESS ROUTINE. MORE EXPRESSION.</span>
          </div>
        </section>
        <section className={styles.platforms} aria-label="対応プラットフォーム">
          <p>いつものSNSを、ひとつの場所で。</p>
          <div>
            <span>Threads</span>
            <span>𝕏</span>
            <span>Instagram</span>
          </div>
          <small>
            ※ 対応する投稿・分析機能はプラットフォームごとに異なります。
          </small>
        </section>
        <section id="features" className={styles.section}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>01 — FEATURES</p>
            <h2>
              発信に集中できる、
              <br />
              運用の仕組みを。
            </h2>
            <p className={styles.muted}>
              投稿づくりで手が止まる。予約を忘れる。振り返る時間がない。
              <br />
              その日々の作業を、NexAutoでつなぎます。
            </p>
          </div>
          <div className={styles.featureGrid}>
            {features.map(({ icon: Icon, title, text, label }) => (
              <article key={label} className={styles.feature}>
                <Icon size={26} strokeWidth={1.5} />
                <p className={styles.miniLabel}>{label}</p>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="screens" className={`${styles.section} ${styles.screens}`}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>02 — INSIDE NEXAUTO</p>
            <h2>
              毎日使うものだから、
              <br />
              見渡せる、迷わない。
            </h2>
            <p className={styles.muted}>
              実際の管理画面で、運用の流れをご紹介します。
            </p>
          </div>
          <article className={styles.screenRow}>
            <div className={styles.screenCopy}>
              <span className={styles.screenNumber}>01 / MANAGE</span>
              <h3>
                投稿の準備も、
                <br />
                進み具合も、ひと目で。
              </h3>
              <p>
                アカウントごとの投稿を一覧で確認。本文検索やステータスの絞り込みで、確認したい投稿にすぐたどり着けます。
              </p>
              <ul>
                <li>
                  <Check size={16} /> 1週間分の投稿案をAIでまとめて生成
                </li>
                <li>
                  <Check size={16} /> 下書き・レビュー・投稿待ちを管理
                </li>
                <li>
                  <Check size={16} /> 本文・画像URL・予約日時を編集
                </li>
              </ul>
            </div>
            <figure className={styles.screenFigure}>
              <a
                href="/landing/posts.png"
                target="_blank"
                rel="noreferrer"
                aria-label="投稿管理のスクリーンショットを拡大（新しいタブ）"
              >
                <Image
                  src="/landing/posts.png"
                  alt="投稿管理の実画面。検索と絞り込み、ステータス変更、編集機能。サンプルデータを使用。"
                  width={1440}
                  height={840}
                  sizes="(max-width: 800px) 100vw, 740px"
                />
              </a>
              <figcaption>投稿管理画面 · クリックで拡大</figcaption>
            </figure>
          </article>
          <article className={`${styles.screenRow} ${styles.reverse}`}>
            <div className={styles.screenCopy}>
              <span className={styles.screenNumber}>02 / ANALYZE</span>
              <h3>
                投稿して終わり、から
                <br />
                次につながる発信へ。
              </h3>
              <p>
                アカウントごとの総表示回数やいいね数、投稿ごとの反応をまとめて確認。数字を見ながら、次に届ける内容を考えられます。
              </p>
              <ul>
                <li>
                  <Check size={16} /> アカウント別にパフォーマンスを確認
                </li>
                <li>
                  <Check size={16} /> 投稿ごとの表示・いいね・リプライを比較
                </li>
                <li>
                  <Check size={16} /> 分析レポートの確認・印刷に対応
                </li>
              </ul>
            </div>
            <figure className={styles.screenFigure}>
              <a
                href="/landing/analytics.png"
                target="_blank"
                rel="noreferrer"
                aria-label="分析のスクリーンショットを拡大（新しいタブ）"
              >
                <Image
                  src="/landing/analytics.png"
                  alt="分析の実画面。総投稿数、総表示回数、総いいね数、投稿ごとのメトリクス。数値はサンプル。"
                  width={1440}
                  height={840}
                  sizes="(max-width: 800px) 100vw, 740px"
                />
              </a>
              <figcaption>分析画面 · クリックで拡大</figcaption>
            </figure>
          </article>
          <p className={styles.sampleNote}>
            掲載画面は実際のUIをサンプルデータで表示したものです。アカウント名・投稿内容・数値は架空のもので、導入実績や成果を示すものではありません。
          </p>
        </section>
        <section className={`${styles.section} ${styles.team}`}>
          <div>
            <p className={styles.eyebrow}>BUILT FOR YOUR TEAM</p>
            <h2>
              ひとつのアカウントから、
              <br />
              チームの運用まで。
            </h2>
            <p>
              自社の発信にも、複数ブランドの運用にも。
              <br />
              役割とアカウントを整理して、日々の仕事を進められます。
            </p>
          </div>
          <div className={styles.teamItems}>
            <article>
              <Layers3 size={23} />
              <div>
                <h3>複数アカウントを一元管理</h3>
                <p>投稿も分析も、アカウントを切り替えて確認。</p>
              </div>
            </article>
            <article>
              <Check size={23} />
              <div>
                <h3>役割に合わせたアクセス</h3>
                <p>管理者と運用担当者で、操作できる範囲を分担。</p>
              </div>
            </article>
            <article>
              <MessageCircle size={23} />
              <div>
                <h3>Threadsの自動リプライ</h3>
                <p>
                  対象アカウントでは、反応に応じた返信条件とテンプレートを設定。
                </p>
              </div>
            </article>
          </div>
        </section>
        <section id="faq" className={`${styles.section} ${styles.faq}`}>
          <div>
            <p className={styles.eyebrow}>03 — FAQ</p>
            <h2>よくある質問</h2>
          </div>
          <div>
            {faqs.map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className={styles.closing}>
          <p className={styles.eyebrow}>MAKE ROOM FOR WHAT&apos;S NEXT.</p>
          <h2>
            作業をつなぐ。
            <br />
            発信は、もっと自由に。
          </h2>
          <p>
            外部提供に向けて準備中です。
            <br />
            料金・導入方法は、提供開始時にご案内します。
          </p>
          <a href="#features" className={styles.primary}>
            NexAutoの特徴を確認する <ArrowRight size={17} />
          </a>
          <Link href="/app" className={styles.existing}>
            ご利用中の方はこちら <ArrowRight size={14} />
          </Link>
        </section>
      </main>
      <footer className={styles.footer}>
        <NexAutoLogo width={128} />
        <p>発信の、その先へ。</p>
        <small>© {new Date().getFullYear()} NexAuto</small>
        <Link href="/app">
          ログイン <ArrowRight size={13} />
        </Link>
      </footer>
    </div>
  );
}
