import { Link, useParams } from "react-router-dom";
import { POSTS, CHANGELOG, type Post } from "../content/site";
import { ThemeToggle, useTheme } from "../lib/theme";

/* Shared chrome for secondary marketing pages. */
export function SitePage({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  const { dark, toggle } = useTheme();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-paper-900 font-serif text-base font-semibold leading-none text-paper-50">C</span>
            <span className="font-serif font-semibold tracking-tight">Copyr</span>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle dark={dark} onToggle={toggle} />
            <Link to="/app" className="rounded-lg bg-brand-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
              Open app
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-slate-600 dark:text-slate-400">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}

export function BlogIndex() {
  return (
    <SitePage title="Blog" subtitle="Insights on deal flow, portfolio management, and VC operations">
      <div className="space-y-5">
        {POSTS.map((p) => (
          <Link
            key={p.slug}
            to={`/blog/${p.slug}`}
            className="block rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-brand-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="text-xs text-slate-400">
              {new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              {" · "}
              {p.category}
            </p>
            <h2 className="mt-1 text-lg font-semibold">{p.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{p.excerpt}</p>
          </Link>
        ))}
      </div>
    </SitePage>
  );
}

export function BlogPost() {
  const { slug } = useParams();
  const post: Post | undefined = POSTS.find((p) => p.slug === slug);
  if (!post) return <SitePage title="Not found"><p className="text-slate-500">That post doesn't exist.</p></SitePage>;
  return (
    <SitePage title={post.title}>
      <p className="text-xs uppercase tracking-wide text-slate-400">
        {new Date(post.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} · {post.category}
      </p>
      <article className="mt-6 space-y-4 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
        {post.body.map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </article>
      <Link to="/blog" className="mt-8 inline-block text-sm font-medium text-brand-600 hover:underline">← All posts</Link>
    </SitePage>
  );
}

export function ChangelogIndex() {
  return (
    <SitePage title="Changelog" subtitle="Latest updates and improvements to the platform">
      <div className="relative space-y-6 border-l border-slate-200 pl-6 dark:border-slate-800">
        {CHANGELOG.map((c) => (
          <div key={c.slug} className="relative">
            <span className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand-500 dark:border-slate-950" />
            <p className="text-xs text-slate-400">
              {new Date(c.date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
            </p>
            <h2 className="mt-0.5 text-lg font-semibold">{c.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{c.body}</p>
          </div>
        ))}
      </div>
    </SitePage>
  );
}

function LegalShell({ title, subtitle, sections }: { title: string; subtitle: string; sections: Array<[string, React.ReactNode]> }) {
  return (
    <SitePage title={title} subtitle={subtitle}>
      <p className="text-xs text-slate-400">Effective date: August 22, 2026 · Last modified: August 22, 2026</p>
      <div className="mt-6 space-y-8">
        {sections.map(([heading, body]) => (
          <section key={heading}>
            <h2 className="text-base font-semibold">{heading}</h2>
            <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{body}</div>
          </section>
        ))}
      </div>
    </SitePage>
  );
}

export function PrivacyPolicy() {
  return (
    <LegalShell
      title="Privacy Policy"
      subtitle="How we collect, use, and protect your information"
      sections={[
        ["Our commitment to your privacy", <p key="c">Your privacy and data confidentiality are our highest priorities. Copyr will never sell, share, rent, or disclose your personal information, deal flow data, portfolio information, investment theses, or confidential business information to any external party without your explicit written consent.</p>],
        ["Information we collect", <ul key="l" className="list-disc space-y-1 pl-5"><li>Account details you provide (name, email, firm).</li><li>User content: companies, deals, documents, notes and custom fields you create.</li><li>Inbound emails you forward, including attachments.</li><li>Usage data (access logs, feature usage) kept for security and product improvement — never sold.</li></ul>],
        ["AI processing", <p key="a">Deal content is processed by AI solely to provide the features you request (triage, extraction, memos). Your content is not used to train foundation models, and processed data stays scoped to your workspace.</p>],
        ["Sharing", <p key="s">We share data only with sub-processors required to run the service (cloud hosting, transactional email), under confidentiality obligations, and only as necessary to provide the service or when required by law. We will attempt to notify you before disclosing data in response to legal requests unless prohibited.</p>],
        ["Security", <ul key="sec" className="list-disc space-y-1 pl-5"><li>TLS in transit; encryption at rest.</li><li>Workspace-level data isolation with row-scoped queries.</li><li>Private object storage behind short-lived signed URLs.</li><li>API key authentication with per-request tenant resolution.</li></ul>],
        ["Retention & deletion", <p key="r">Your data is retained while your workspace is active. On deletion request, content is removed within 90 days; backups purge within an additional 30 days. You can export everything (CSV/JSON) at any time from Settings → Export.</p>],
        ["Your rights", <p key="y">Access, correction, deletion, portability and objection rights are honored for all users regardless of jurisdiction. Contact privacy@copyr.dev; we respond within 30 days.</p>],
        ["Contact", <p key="ct">Copyr — privacy@copyr.dev · security@copyr.dev · support@copyr.dev</p>],
      ]}
    />
  );
}

export function TermsOfService() {
  return (
    <LegalShell
      title="Terms of Service"
      subtitle="Terms and conditions for using Copyr"
      sections={[
        ["Important notice about your data", <p key="d"><b>Your data belongs to you and only you.</b> We will never share, sell, rent or disclose your deal flow data or confidential business information without explicit consent. Your trust is our foundation.</p>],
        ["Description of services", <ul key="ds" className="list-disc space-y-1 pl-5"><li>Deal flow CRM: pipeline management, custom fields/stages, tags, notes, activity logs.</li><li>AI-powered analysis: extraction, triage, investment memo generation.</li><li>Document processing: link conversion, uploads, permanent storage.</li><li>Email ingestion via forwarding/webhooks.</li><li>Capture endpoint for browser extensions.</li><li>REST API + MCP server for programmatic and agent access.</li><li>Integrations: Zapier/Tally-compatible webhooks.</li></ul>],
        ["AI credits", <p key="ai">Plans include a monthly AI credit allocation consumed by extraction, triage, classification and memo features. Top-ups are available pay-as-you-go; unused credits do not roll over unless your plan says otherwise.</p>],
        ["Acceptable use", <p key="au">Use the service lawfully and only for content you have the right to process. Don't probe, scrape other tenants' data, or abuse rate limits. The capture endpoint must only be used on pages you're authorized to access.</p>],
        ["AI-generated content disclaimer", <p key="ag">AI output may contain errors or bias. It is informational only, is not investment advice, and should be independently verified before any decision.</p>],
        ["Billing & refunds", <p key="b">Subscriptions bill monthly or annually in advance. Full refund available within 14 days of initial subscription; afterwards fees are final except where required by law.</p>],
        ["Termination", <p key="t">You may terminate anytime; access continues until end of the billing period. Upon termination your content is deleted within 90 days subject to legal retention.</p>],
        ["Governing law & contact", <p key="g">These terms are governed by the laws of Delaware, USA. Questions: legal@copyr.dev · support@copyr.dev</p>],
      ]}
    />
  );
}

export function CookiePolicy() {
  return (
    <LegalShell
      title="Cookie Policy"
      subtitle="What we store in your browser, and why"
      sections={[
        ["Essential storage", <p key="e">We use browser localStorage for one thing only: your theme preference (<code>copyr-theme</code>). Session authentication cookies arrive with the auth milestone and will be strictly first-party.</p>],
        ["No tracking", <p key="n">No advertising cookies, no cross-site trackers, no fingerprinting. Product analytics, if enabled later, will be aggregate-only and disclosed here first.</p>],
        ["Managing cookies", <p key="m">You can clear site data from your browser at any time; the only effect is resetting your theme preference.</p>],
      ]}
    />
  );
}

export function About() {
  return (
    <SitePage title="About Copyr" subtitle="The deal flow machine that runs itself">
      <div className="space-y-4 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
        <p>
          Copyr started from a simple observation: venture firms don't lack deal flow — they lack a
          system that absorbs it. Decks arrive by email, die in inboxes, and someone pays for it in
          hours of copy-paste.
        </p>
        <p>
          We rebuilt the deal CRM around ingestion and intelligence: every inbound channel becomes a
          structured record, every record is agent-operable through MCP, and humans spend their time
          on judgment instead of data entry.
        </p>
        <p className="text-slate-500 dark:text-slate-400">
          Contact: support@copyr.dev
        </p>
      </div>
    </SitePage>
  );
}
