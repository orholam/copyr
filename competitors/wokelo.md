# Competitor Deep Dive: Wokelo AI

**Report date:** August 23, 2026
**Scope:** Publicly available information only. Conflicting public data points (founding year, funding totals, HQ) are presented side-by-side rather than silently resolved. Company/self-published claims are labeled; analysis is separated from facts.

---

## 1. Executive Summary

Wokelo AI (wokelo.ai) is a **Seattle + Bengaluru-based agentic AI platform for investment research and due diligence**, serving private equity firms, investment banks, management consultancies, corporates, and VC/asset managers. Founded by two former management consultants — **Siddhant Masson (CEO)** and **Saswat Nanda (CTO)** — the company automates diligence, sector research, and portfolio monitoring with proprietary LLM-based agents, a 20M+-company proprietary database, and premium data integrations (CapIQ, Crunchbase, etc.).

It has raised **$5.5M in total disclosed funding**, most recently a **$4M seed (closed Oct 1, 2024) co-led by Ahead VC and Array Ventures**, which notably included a **minority equity investment from KPMG LLP's venture arm** — with KPMG's own U.S. deal advisory practice using the product. At seed time it reported **13 employees and 35+ customers**, growth entirely inbound, and was "getting close to profitability" per its CEO (GeekWire). By 2025–2026 the company had roughly doubled headcount (~40 per Caplight), landed enterprise signals including **Microsoft** (customer story under Microsoft's AI First Movers program; Azure Marketplace listing) and **NextEra Energy** (Caplight market signal), and launched **akta.pro**, a pay-as-you-go private-markets data API/MCP infrastructure product that repositions Wokelo as "agentic infra for private markets."

**Business-perspective verdict:** Wokelo is the most institutionally credible of the three companies profiled in this series — real revenue customers at brand-name consultancies/banks, a Big Four strategic investor *and user*, near-breakeven economics claimed early, and a two-continent cost structure. Its main strategic pivot (akta.pro) opens a second business line selling data to AI builders, which diversifies revenue but splits focus against well-funded data incumbents.

---

## 2. Company Snapshot

| Field | Detail | Source |
|---|---|---|
| Company | Wokelo AI ("Wokelo") | wokelo.ai |
| Founded | **2022 or 2023 (sources conflict — see §3)** by Siddhant Masson & Saswat Nanda | GeekWire says co-founded 2022; Economic Times/Business Insider/G2 say 2023 |
| Founders | Siddhant "Sid" Masson, CEO (ex-Deloitte consultant; MS Business Analytics, Univ. of Washington, moved to Seattle 2021); Saswat Nanda, CTO (former consultant, based India) | GeekWire; Economic Times (Nov 2025) |
| Headquarters | Seattle, WA — 92 Lenora Street (CB Insights); GeekWire describes "Seattle-area"/Redmond, WA | CB Insights; GeekWire |
| Second hub | Bengaluru, India (Wokelo India Private Limited registered entity) | Tracxn legal-entity record; Economic Times |
| Operating model | "24-hour company" across two cities: CEO spends ~8–9 months/year in Seattle, remainder in Bengaluru; co-founder evenings/ mornings overlap via calls | Economic Times / Business Insider (Nov 2025) |
| Employees | 13 (Oct 2024, GeekWire) → ~40 (Caplight firmographics, 2025–26); Crunchbase band 11–50 | GeekWire; Caplight |
| Total disclosed funding | **$5.5M** across pre-seed + seed(s) (PitchBook, CB Insights, Caplight, GeekWire). One aggregator (startupintros) claims $7.5M across 3 rounds — outlier, unconfirmed elsewhere | multiple, see §4 |
| Latest round | $4M Seed closed Oct 1, 2024; announced Oct 9, 2024; **co-led by Ahead VC and Array Ventures** | GeekWire; Tracxn; f4.fund |
| Marquee investors | KPMG LLP (via KPMG Ventures, minority equity), Array Ventures, Ahead VC, Geek Ventures, Rebellion Ventures, Perpetual Venture Capital, Pack Ventures, Untapped Capital, Quant Fund, angels | GeekWire; CB Insights; Caplight |
| Name origin | Derived from the phrase "hello future of work" | GeekWire |
| Careers | Hiring via Ashby (jobs.ashbyhq.com/wokelo-ai) | wokelo.ai footer |

---

## 3. Founding Year Discrepancy (flagged)

- **GeekWire (Oct 9, 2024):** "co-founded in 2022 by two former management consultants."
- **CB Insights:** founded 2022.
- **Economic Times / Business Insider (Nov 2025):** Masson "co-founded Wokelo AI in 2023" after leaving Deloitte and completing his UW master's.
- **G2 seller profile:** "Year founded 2023"; G2 shows "Serving customers since 2023."

Most likely reading: idea/incorporation ~2022, product/GTM launch 2023. For competitive purposes: the company is roughly 3–4 years old as of this report.

---

## 4. Funding History & Investors

| Round | Date | Amount | Notes |
|---|---|---|---|
| Pre-seed | Jun 2023 | undisclosed (~$1.5M implied if total $5.5M incl. $4M seed) | Caplight lists Pre-Seed Jun 1, 2023; participants included Untapped Capital, Pack Ventures, Array Ventures (per CB Insights multi-round participation) |
| Seed (listed by CB Insights as "Seed VC") | Mar 21, 2022 per CBI (date appears inconsistent with founding-year records; treat cautiously) | undisclosed | CBI only |
| **Seed VC-II** | **Oct 1, 2024** | **$4.0M** | Co-led **Ahead VC + Array Ventures** (f4.fund; GeekWire describes participants without lead designation; Tracxn describes Ahead VC leading alongside Array at a $5.08M figure). Participants: KPMG (Ventures), Geek Ventures, Rebellion Ventures, Perpetual Venture Capital, Pack Ventures, Untapped Capital, Quant Fund, and WellFound (all listed in CB Insights investor table) |

- **KPMG LLP minority equity investment** announced the same day (Oct 1, 2024) via KPMG press release: combines "Wokelo's LLM-based technology and agentic workflows with KPMG's deal advisory and strategy expertise." KPMG's U.S. Deal Advisory & Strategy lead **Carole Streicher**: "AI is enhancing our approach to both the front-end of dealmaking and post-close integration…" **Andrew Matuszak**, KPMG Ventures MD: the investment "exemplifies our commitment to harnessing cutting-edge technologies."
- Context KPMG cited: its 2024 mid-year M&A survey found **42% of dealmakers already using generative AI** in the dealmaking process.
- Funding totals across databases: PitchBook $5.5M; Caplight $5.5M; CB Insights $5.5M (3 rounds); startupintros $7.5M (outlier).
- Use of proceeds (seed): product development/capability expansion plus sales & support team buildout (GeekWire).

---

## 5. Product Suite

### 5.1 Core platform (wokelo.ai)
Positioning evolved from "secure generative AI research/diligence platform" (2023–24) to **"Agentic infra for private markets — the intelligence layer that powers your firm, your agents, and your stack"** (current site).

Components:
- **Agentic Builder™:** drag-and-drop construction of custom research agents trained on a firm's own playbooks/methodologies.
- **Agent Marketplace:** pre-built agents published by IB/PE/consulting practitioners for day-0 deployment (e.g., sell-side prep, buy-side DD, comps/benchmarking, buyer universe; commercial due diligence, market assessment; deal screening, sector research, portfolio monitoring; competitive intelligence, corp dev).
- **Domain-tuned LLMs:** bespoke models "trained for investors and consultants," with no-training-on-customer-data policy and hallucination-guardrail claims.
- **Proprietary data:** database of **20M+ companies** plus **30+ premium subscriptions** (Capital IQ, Crunchbase, etc.) integrated into outputs.
- **Command Center:** workflow oversight, audit trails, RBAC, data-source governance, exports to PowerPoint/Word/PDF/Excel.
- **Use cases by segment:** PE (sourcing→DD→portfolio monitoring), IB (sell-side prep, buyer lists), consulting (CDD, market assessment), VC (screening, sector deep-dives), corporates (competitive intel, CVC), asset management.
- Distribution surfaces: **Microsoft Azure Marketplace SaaS listing** ("build AI agents that automate research and analysis workflows… domain-tuned LLMs think and work like dealmakers"); Microsoft customer-story page (AI First Movers, FY26) describing synthesis of data rooms, extraction from thousands of documents, and memo generation.

### 5.2 akta.pro (new business line)
A standalone **private-company data & signals API** product, branded "by Wokelo AI":
- **Coverage claims:** 20M+ entity-resolved global companies; 70+ structured data points per company; 30K+ sub-sectors monitored; ~80% of news noise filtered before delivery; news taxonomy of 77 event-type codes across 11 categories; NAICS/SIC/IPTC/IAB classifications; patent-pending universal entity resolution.
- **Products:** Company Database API, Company News (entity-resolved, sentiment-scored, AI-summarized), Industry News, alternative signals (headcount trends from LinkedIn, website traffic, employee reviews, product reviews, job posts).
- **Delivery:** REST API, **remote MCP server** (`mcp.akta.pro/mcp`, OAuth/API-key auth for Claude, ChatGPT, Cursor, VS Code, Claude Code etc.), CLI, bulk data; pay-as-you-go credits with free resolve-tier tools; enterprise tiers.
- **Compliance:** SOC 2 Type II certified; ISO 27001 compliant; end-to-end encryption; no customer-data training.
- **Self-published benchmark:** claims **#1 ranked news provider** vs News APIs/agentic search/LLMs/bulk scrapers — F1 81.3 (vs GPT-5.5 62.5, SerpAPI 52.6, Perigon 48.6), 93% accuracy, $0.50 per 1K accurate articles — based on 71,408 articles scored across 133 companies. *Self-reported methodology; not independently audited.*
- **Cited users:** KPMG, Adobe, Premji Invest, JLL, Chicago Booth, Zams, Vestberry; testimonial from Yohei Nakajima (BabyAGI creator): "80% noise removed… 10M+ AI tokens saved to process news/month."
- Listed customers per Caplight market signals: **Microsoft** and **NextEra Energy** (both logged Sep 6, 2025).

---

## 6. Traction, Customers & Voice-of-Customer

**Scale markers (public):**
- Oct 2024 (seed announcement): **35+ customers** across PE, VC, corporate development, IB, consulting; 13 employees; growth "based on inbound interest, without marketing"; **"close to profitability"** (CEO quote, GeekWire).
- Enterprise logos surfaced 2024–2026: **KPMG (user + investor)**, **Microsoft** (customer story + marketplace), **NextEra Energy** (signal), plus akta.pro-cited teams (Adobe, Premji Invest, JLL, Chicago Booth).
- G2: **4.9/5 average across ~19–20 reviews**, 100% five-star distribution shown at seller level (individual reviews include some 4.5s). Reviewers: GPs, VCs, consultants (incl. one enterprise >1000-employee verified reviewer).

**What reviewers praise (G2, 2025):**
- Speed and depth of company/industry reports; cited, client-ready outputs.
- Surfaces items humans missed during early-stage diligence.
- Consolidates multiple paid data subscriptions into one workflow.
- Outstanding customer support; monthly product improvement cadence.

**Criticisms recorded by reviewers:**
- Thin context on very new/niche startups (recurring theme).
- Occasional report-generation latency for certain workflows.
- Data representation/visuals could improve.
- Wants deeper founder-level diligence modules.

**Self-published impact metrics (marketing):** deal origination uplift from 1–2 to 3–5 proprietary deals/quarter (+2–3x pipeline); diligence cycle compression from 4–8 weeks to 2–3 weeks (~2x faster).

---

## 7. Go-to-Market

1. **Inbound-led enterprise SMB motion:** no marketing spend through 2024; demand driven by content/word-of-mouth in PE/consulting communities (GeekWire).
2. **Strategic channel via KPMG:** capital *plus* embedded usage inside KPMG U.S. Deal Advisory — both a lighthouse logo and a potential global distribution path within the Big Four network.
3. **Cloud-marketplace placement:** Azure Marketplace listing lowers procurement friction for Microsoft-centric enterprises; Microsoft customer-story participation (AI First Movers FY26) adds co-marketing halo.
4. **Two-hub cost structure:** Bengaluru engineering/research talent paired with Seattle enterprise sales presence; founders run a split-time "24-hour company" (ET/BI profiles).
5. **Developer/platform expansion (akta.pro):** PLG pay-as-you-go API targeting AI-agent builders — a bottom-up complement to the top-down enterprise platform sale; MCP-native positioning rides the agent-tooling wave.

---

## 8. News & Milestone Timeline

| Date | Event | Source |
|---|---|---|
| 2021 | Masson relocates to Seattle for UW MSBA after ~3 years at Deloitte | ET/BI |
| 2022–2023 | Company founded (see §3 discrepancy); pre-seed raised Jun 2023 (Caplight) | multiple |
| 2023 | Serving customers (G2 "since 2023"); early product = Gen-AI diligence report generation using OpenAI GPT + open models with anti-hallucination cognitive engine | G2; Inventiva/CB Insights roundup |
| **Oct 1, 2024** | **$4M seed closes; KPMG LLP minority equity investment announced** | KPMG press release; Barchart |
| Oct 9, 2024 | GeekWire coverage: 35+ customers, 13 staff, near-profitability claim, name origin | GeekWire |
| Jul 28 – Nov 4, 2025 | Cluster of news items logged by Crunchbase (contents paywalled; includes Jul 2025 and Nov 3–4, 2025 entries — likely product/PR milestones, unverified) | Crunchbase news feed |
| Aug 27, 2025 | ET Panache / Business Insider founder profiles: Bengaluru-vs-Seattle dual-city operations | ET; BI |
| Sep 6, 2025 | Market-signal trackers log Microsoft and NextEra added as customers | Caplight |
| Feb 16, 2026 | Named among "Top 10 Generative AI Startups [from India] In 2026" trade listicle | Inventiva via CB Insights |
| 2026 | akta.pro live (API + MCP server + playground); homepage repositioned to "Agentic infra for private markets"; hiring active via Ashby | akta.pro; wokelo.ai |

---

## 9. Competitive Positioning

**Named competitors/alternatives (third-party taxonomies):**
- CB Insights alternatives: **AlphaSense, DiligenceVault, RavenPack**, Auquan, Alchemy Research & Analytics, Hebbia.
- Caplight comparables: **Hebbia (77% similarity), Cypris (72%), AlphaSense (71%)**.
- Adjacent: generic LLM chat (ChatGPT/enterprise copilots), Harvey (legal), internal bank/consulting AI builds, legacy research vendors (D&B Hoovers et al.).

**Differentiators evidenced in public material:**
1. **Workflow depth over chat:** purpose-built agents producing cited, client-ready deliverables (PPT/Word/PDF/Excel) rather than conversational answers.
2. **Data moat attempt:** 20M+ entity-resolved companies + 30+ licensed premium feeds fused into outputs — harder to replicate than prompt engineering.
3. **Big Four validation:** KPMG as investor-user is a trust shortcut in risk-averse professional-services buying.
4. **Cost structure:** dual-hub model lets it serve enterprise buyers at price points Silicon Valley peers may struggle to match profitably.
5. **Agent-era optionality:** akta.pro positions Wokelo to sell shovels (data infra) to the same AI wave that could otherwise commoditize its application layer.

**Risks visible from the public record (analysis):**
- **Scale asymmetry:** its most-cited comparables — Hebbia and AlphaSense (Caplight/CB Insights taxonomies) — are much larger, later-stage companies that can outspend Wokelo's $5.5M of disclosed funding on data licensing and model R&D.
- **Self-reported benchmarks:** akta.pro's #1-news-provider chart is self-published; sophisticated buyers will ask for independent replication.
- **Niche-company coverage gap:** repeatedly flagged by its own reviewers — material for VC use cases where targets are pre-web-footprint.
- **Strategic-split risk:** running an enterprise application business and a developer data-API business simultaneously with ~40 people risks under-resourcing both.
- **Channel concentration:** KPMG is simultaneously investor, customer, and channel — excellent while aligned, but creates dependency/conflict questions if KPMG builds in-house tooling or negotiates aggressively.
- **Model commoditization:** domain-tuned-LLM advantages erode as frontier models improve at long-context document synthesis; defensibility migrates toward proprietary data and workflow lock-in (which akta.pro hedges).

---

## 10. SWOT Summary

| Strengths | Weaknesses |
|---|---|
| KPMG investor-user relationship; enterprise logo traction (Microsoft, NextEra signals) | Small balance sheet ($5.5M) vs. Hebbia/AlphaSense scale |
| Near-profitability claimed at seed; inbound GTM efficiency | Coverage gaps on niche/new companies (per reviews) |
| Proprietary 20M-company graph + 30 premium feeds | Two-business-line focus risk (platform + akta.pro) |
| Dual-hub cost advantage; strong G2 ratings (4.9) | Founding-year/data inconsistencies complicate diligence narrative |

| Opportunities | Threats |
|---|---|
| akta.pro riding agent/MCP infrastructure demand | Hebbia/AlphaSense feature encroachment down-market |
| KPMG global network rollout beyond US deal advisory | Frontier-model commoditization of synthesis layer |
| Expansion from diligence into portfolio monitoring/IR workflows | Big consultancies insourcing AI research stacks |
| Marketplace-led enterprise distribution (Azure) | Data-licensing cost inflation squeezing margins |

---

## 11. Intelligence Gaps (could not verify)

- Current ARR/customer count (last public figure: 35+ customers, Oct 2024).
- Contents of the Jul–Nov 2025 Crunchbase news cluster (paywalled).
- Whether akta.pro has separate funding, pricing tiers' actual dollar values, or meaningful independent adoption.
- Valuation of any round (not disclosed anywhere public).
- Exact Bengaluru headcount split and key hires beyond founders.
- The identity/status of "Quant Fund" (India-listed investor in CBI data) and the March 2022 "Seed VC" entry's accuracy.

---

## 12. Sources

- GeekWire (Oct 9, 2024): "Wokelo raises $4M for AI-driven due diligence, sees customer traction in M&A, investing and consulting"
- KPMG LLP press release (Oct 1, 2024): "Wokelo Announces Minority Equity Investment from KPMG LLP"; Barchart wire copy
- Economic Times / Business Insider (Nov 2025): Bengaluru-vs-Seattle founder features
- PitchBook profile (2026): totals, investor list; Caplight profile: rounds, comparables, firmographics, market signals
- CB Insights: company/financials/investors/customers pages
- Tracxn: Ahead VC investment record ($5.08M seed figure alongside Array; note variance vs. $4M headline — Tracxn figure likely includes portions/fees; headline amount per GeekWire/KPMG is $4M); Wokelo India Private Limited entity page
- wokelo.ai (platform pages, solutions/private-equity impact table, footer/careers)
- akta.pro (data products, benchmarks, compliance badges, testimonials); docs.akta.pro; mcpservers.org listing of akta.pro MCP (14 tools, auth, coverage stats)
- marketplace.microsoft.com (Wokelo SaaS listing); microsoft.com AI First Movers customer story
- G2 (seller + product review pages, 2025 reviews); SaaSworthy/FutureStack pricing notes (custom/quotation-based; no self-serve pricing)
- startupintros.com (outlier $7.5M claim — flagged); f4.fund AHEAD VC activity feed

*All performance-impact figures in §6 attributed tables and akta.pro benchmark results are Wokelo self-published claims.*
