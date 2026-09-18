/** Site content for the blog & changelog (mirroring Roulette's editorial structure). */

export interface Post {
  slug: string;
  date: string;
  title: string;
  excerpt: string;
  category: "Product" | "Industry" | "Playbooks";
  body: string[];
}

export const POSTS: Post[] = [
  {
    slug: "launching-copyr-deal-management-for-vc",
    date: "2026-08-22",
    title: "Launching Copyr: Deal Management for VC",
    category: "Product",
    excerpt:
      "We built Copyr because nothing else solved the real bottleneck in venture capital: ingestion. Here is what it does and why we are opening it up.",
    body: [
      "Every VC firm drowns in the same way: decks arrive by email, links expire, data lives in inboxes instead of a system of record. Analysts spend hours per week doing data entry that no one chose as a job.",
      "Copyr attacks ingestion first. Forward an email — AI identifies every company mentioned, creates records, and files attachments. Paste a DocSend link — it becomes a permanent PDF attached to the company. Drop fifty PDFs — they parse overnight.",
      "The second bet is agent-native. Every capability in the product is exposed through MCP, so your AI assistants can triage an inbox, move deals, or draft weekly reviews with the same tools your team uses.",
      "This is the CRM we wanted as investors. We're opening it up today — the seeded demo workspace shows the entire flow in under five minutes.",
    ],
  },
  {
    slug: "sector-focused-vs-generalist-vc-funds",
    date: "2026-08-20",
    title: "Sector-Focused vs. Generalist VC Funds: Finding Your Investment Thesis",
    category: "Industry",
    excerpt:
      "How to decide between a sector-focused or generalist fund strategy and build an investment thesis that resonates with LPs.",
    body: [
      "Sector-focused funds win on pattern recognition and network density; generalists win on optionality and breadth of opportunity. The right answer depends on your edge, not on fashion.",
      "Whatever you choose, encode the strategy into your pipeline: custom fields like Sector and Geography with required intake values keep the fund honest about its thesis — and give AI extraction targets that make every deck comparable.",
    ],
  },
  {
    slug: "solo-gps-reshaping-venture-capital",
    date: "2026-08-18",
    title: "How Solo GPs Are Reshaping the Venture Capital Landscape",
    category: "Industry",
    excerpt:
      "Why solo GP funds are growing fast and how individual fund managers are competing with larger firms for the best deals.",
    body: [
      "Solo GPs now close funds at a pace the industry hasn't seen before. Their constraint isn't capital — it's operational leverage.",
      "Automation is the great equalizer: a one-person firm running Copyr ingests and triages deal flow like a team of three, which changes who gets to the best deals first.",
    ],
  },
  {
    slug: "kanban-boards-deal-management-vcs",
    date: "2026-08-12",
    title: "Kanban Boards for Deal Management: Visual Pipeline Tracking for VCs",
    category: "Playbooks",
    excerpt:
      "How to use kanban-style boards for visual deal pipeline management and why it works better than traditional list views.",
    body: [
      "Lists hide motion; boards show it. When your Monday meeting opens on a board where cards moved since Friday, stale deals announce themselves.",
      "Keep stages to 5–7, define explicit exit criteria per column, and let drag-and-drop write the history — every move should land on the company timeline automatically.",
    ],
  },
  {
    slug: "meeting-notes-action-items-founder-insights",
    date: "2026-08-06",
    title: "Meeting Notes to Action Items: How Top VCs Capture Founder Insights",
    category: "Playbooks",
    excerpt:
      "Best practices for capturing meeting notes during founder calls and turning them into structured deal intelligence.",
    body: [
      "Notes rot in private docs. The firms that learn fastest attach notes directly to the deal record within minutes of a call ending, @mention the partner who owns follow-ups, and convert every 'we should check' into a tracked next step.",
      "With Copyr's notes + mentions, each note lands on both the deal timeline and the mentioned teammate's audit trail — nothing falls through.",
    ],
  },
  {
    slug: "ai-analyze-pitch-decks-vc",
    date: "2026-07-30",
    title: "Using AI to Analyze Pitch Decks: What VCs Can Learn in Minutes",
    category: "Product",
    excerpt:
      "How AI-powered pitch deck analysis helps VCs extract key data points, spot patterns, and make faster screening decisions.",
    body: [
      "Deck analysis used to be a human reading forty slides; now it's a schema. Define the fields your fund cares about once — ARR, growth, team size, geography, conviction — and AI fills them from every inbound deck.",
      "The compounding effect is portfolio-level: hundreds of comparably structured records turn your pipeline itself into a dataset you can analyze.",
    ],
  },
];

export interface ChangelogEntry {
  slug: string;
  date: string;
  title: string;
  body: string;
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    slug: "mcp-full-surface-105-tools",
    date: "2026-08-22",
    title: "Full MCP surface — 105 tools, resources & prompts",
    body: "Every entity now has complete create/read/update/delete over MCP, plus admin surfaces (API keys, intake forms, webhooks, share links), listable resources and new guided prompts like company-deep-dive and onboard-workspace.",
  },
  {
    slug: "mcp-server-and-agent-tools",
    date: "2026-08-21",
    title: "MCP server & 34 agent tools",
    body: "Copyr is now fully operable by AI agents: a Model Context Protocol server exposes pipelines, ingestion, analytics, sharing and more over stdio and streamable HTTP.",
  },
  {
    slug: "browser-capture-endpoint",
    date: "2026-08-19",
    title: "Browser capture endpoint",
    body: "POST /capture turns any webpage into a company record — domain-matched, deal-linked, and permanently preserved. Built for the upcoming extension.",
  },
  {
    slug: "ai-investment-memos",
    date: "2026-08-14",
    title: "AI investment memos",
    body: "Generate a structured thesis memo for any company from its extracted deck data — What they do / Why it fits / Key risks / Next steps.",
  },
  {
    slug: "tags-and-export",
    date: "2026-08-08",
    title: "Tags & data export",
    body: "Tag companies and deals, filter by tag across views, and export your full pipeline to CSV or JSON whenever you like. Your data is always yours.",
  },
  {
    slug: "portfolio-timelines",
    date: "2026-07-28",
    title: "Portfolio update timelines",
    body: "Inbound portco emails are classified (milestone / metric / hiring / funding / news) and streamed into per-company timelines automatically.",
  },
  {
    slug: "share-links",
    date: "2026-07-15",
    title: "Trackable share links",
    body: "Share a single company externally with selective attributes, optional password, expiry, and a full access log.",
  },
];
