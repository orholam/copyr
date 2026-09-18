# Competitor Deep Dive: Roulette (useroulette.com)

**Report date:** August 23, 2026
**Scope:** Publicly available information only. Roulette is a very young, very small company — public information is limited, and this report deliberately avoids speculation. Company claims are labeled as such; analysis is separated from facts. Where public evidence is thin (funding, headcount beyond LinkedIn), that is stated explicitly rather than guessed.

---

## 1. Executive Summary

Roulette is an **AI-powered deal-flow CRM for venture capital firms** at useroulette.com, publicly launched on **March 29, 2026**. It originated as an internal tool at **Redbud VC**, a Columbia, Missouri-based pre-seed fund, and was built to solve one specific problem the founders say incumbent tools ignore: **deal ingestion** — automatically capturing, converting, and structuring inbound deals (decks, emails, calendar invites, forwarded bundles) into permanent, searchable company records.

The product's wedge is explicit price-and-scope disruption: **$50/user/month**, which the company says makes it "4x cheaper per month compared to legacy VC CRMs like Affinity," positioned against tools that solve relationship tracking rather than ingestion. The site lists five design-partner-style customers: Redbud VC, FO.VC, Worcester Investments, Fenway Summer, and Keyhorse VC.

**Business-perspective verdict:** Roulette is a pre-everything startup (LinkedIn shows a 2-person entity; no Crunchbase profile; no disclosed funding) with an unusually clear thesis, credible operator-parentage (Redbud's GP is a Forbes 30 Under 30 lister whose fund just closed a $25M Fund II), and real dogfooding scale claims (Redbud reviews 400–500 deals/month). It is best understood as a venture-studio-style spinout attacking the ingestion/data-retention layer that Decile Hub treats as one feature among many.

---

## 2. Company Snapshot

| Field | Detail | Source |
|---|---|---|
| Product/company name | Roulette ("Bet on better data.") | useroulette.com |
| Website | useroulette.com (docs at docs.useroulette.com) | site |
| Category | AI deal management / CRM for early-stage VC | LinkedIn company page |
| Public launch | March 29, 2026 (blog post); reposted by Redbud Mar 30, 2026 | useroulette.com/blog |
| Origin | Internal tool built at Redbud VC, later opened to other funds | launch blog |
| People associated | Brett Calhoun (GP, Redbud VC) and Collin Hickey (Investor, Redbud VC) — authors of launch posts | redbud.beehiiv.com |
| LinkedIn entity | "Roulette" — Software Development; privately held; listed size 2–10 employees (scraper shows employee count: 2; followers: 4 — page is brand new) | linkedin.com/company/useroulette + scraper metadata |
| HQ location | Not published; Redbud VC is Columbia, Missouri (Roulette appears tied to that operation) | inference from origin; no direct statement found |
| Funding | **None disclosed.** No Crunchbase profile found for useroulette.com; no press coverage of a round | searches Aug 2026 |
| Contact | sales@roulette.com / support@roulette.com | site footer |
| Pricing | $50/user/mo or $500/user/yr (~2 months free); Custom tier for 15+ users with bulk discounts; 30-day free trial | useroulette.com/#pricing |
| Security posture | CASA Tier 2 completed (Cloud Application Security Assessment, App Defense Alliance); workspace-level data isolation; encrypted infrastructure | useroulette.com/#security |

---

## 3. Origin Story & Parent Context

Roulette's launch narrative (Mar 29, 2026 blog, "Launching Roulette: Deal Management for VC"):

- Redbud VC reviews **400–500 deals per month**. At that volume: links expire (~**75% of saved deck links eventually died**), decks disappear, context lives in inboxes, founders send Canva/pitch.com/Google Drive links that don't flow into any system.
- "Most venture tools solve the wrong problem. **Affinity is great for relationship tracking. Attio works as a CRM. But neither of them solves ingestion** — and ingestion is the actual bottleneck."
- "We built this for Redbud first. Now we're opening it up."

Who is behind it:
- **Brett Calhoun** — Managing General Partner, Redbud VC; **Forbes 30 Under 30 (2024, Venture Capital)**; CPA/ABV; MBA Univ. of Missouri; previously co-founded three fintechs, built the Scale Accelerator (4 cohorts), early at Paytient and The LegalTech Fund; ex-Stern Brothers valuation work.
- **Collin Hickey** — Investor at Redbud VC; co-author of both the Roulette launch post and Redbud's fund announcements.
- **Redbud VC context (the parent):** pre-seed fund investing $250K–$500K checks; ~300 LinkedIn outreach messages/week and ~1,500 first calls/year (vcsheet profile); backed 38–41 companies since its 2023-vintage $5M Fund I; closed an **oversubscribed $25M Fund II in March 2026** led by the University of Missouri System Endowment, Square co-founder Jim McKelvey, and AngelList Fund of Funds (Axios Pro exclusive; Startland News). Partners include Willy and Jabbok Schlacks, co-founders of EquipmentShare (**Nasdaq IPO January 2026 at a $7.2B valuation**).

Business significance: unlike typical SaaS startups, Roulette has (a) a live institutional-scale use case as its founding customer, (b) a GP with distribution reach across emerging-manager networks, and (c) an LP bench (McKelvey, AngelList FoF) that understands the exact workflow pain point.

---

## 4. Product: What Roulette Actually Does

Positioning line: "AI-automated deal management for early stage VC." The platform is organized around **five pillars**:

### Pillar 1 — Ingestion (the claimed core differentiator)
- Full Gmail integration; email forwarding address for pitch intake.
- **Universal link conversion:** DocSend, Papermark, Canva, Pitch, Google Drive links auto-converted to PDFs and stored permanently (direct attack on deck-link expiry).
- Calendar-invite capture (creates pipeline records even with no materials attached).
- Granola meeting-notes integration flowing into company data rooms.
- Tally form integration ("Pitch Us" intake forms submit straight into the pipeline).
- Chrome extension (add companies from any website/LinkedIn page).
- Bulk CSV upload without structured format requirements.
- Handles multi-deal forwarded emails ("a fund forwards you 10 deals in one email").

### Pillar 2 — Enrichment
- AI reads ingested materials and auto-builds a structured data room per company.
- Auto-fills stage, sector, geography, ask, and custom fields.
- Founder/company enrichment via **Specter**, LinkedIn scraping.
- Co-investor CRM enrichment and founder-network mapping.

### Pillar 3 — Retention
- Permanent company records tying together every deck, email, note, and data-room artifact.
- Team communication tracking (who emailed whom, when).
- Portfolio-update tracking with AI KPI extraction.
- Search/filtering across full pipeline history; bulk export ("no lock-in").

### Pillar 4 — Sharing
- **AI co-investor matching** (suggests funds in your network per deal based on investment profile).
- Unlimited trackable deal links (open tracking).
- LP dashboards investors can log into to browse pipeline/trends/request founder intros.
- LP CRM and co-investor CRM alongside deal flow.

### Pillar 5 — Synthesis
- AI-generated one-pagers, full investment memos, founder FAQ drafts.
- Chat-with-data-room (RAG against each company's materials).
- Quarterly-report assembly support for LP letters.

### Platform/integrations
- Full public REST API (companies CRUD, AI upload endpoint, analyze endpoint); developer docs at docs.useroulette.com including llms.txt for agent consumption.
- Zapier integration; Specter integration; Granola; Tally.
- AI credits: **500 credits/user/month** included with subscription; AI operations consume credits (docs).

---

## 5. Pricing & Packaging

| Plan | Price | Notes |
|---|---|---|
| Monthly | **$50/user/month** | Unlimited deal ingestion; 500 AI credits/user/mo; all core features |
| Yearly | **$500/user/year** (save ~16%) | Adds priority support, early-access features, onboarding session |
| Custom | Contact sales | Bulk discounts at 15+ users; custom onboarding |

All plans include a 30-day free trial. Marketing claims: saves **"5+ hours per analyst each week"**; **"4x cheaper per month compared to legacy VC CRMs like Affinity"**; zero setup required; "processes 100s of deals daily."

*Analysis:* Roulette's own marketing claims "4x cheaper per month compared to legacy VC CRMs like Affinity," and Decile Group's independent (competing) CRM guide characterizes Affinity pricing as running "into thousands of dollars per month" for firms. Against either framing, $50/user/month is a steep undercut aimed at small/emerging funds, with monetization depth coming later via seats and possibly AI-credit overages.

---

## 6. Traction Evidence & Customers

- **Named customer logos** on site: Redbud VC (parent/design partner), FO.VC, Worcester Investments, Fenway Summer, Keyhorse VC — all small/early-stage or specialized funds, consistent with ICP.
- Testimonial: Brett Calhoun (GP, Redbud): "Roulette streamlined our entire deal flow process, what took hours of manual data entry now happens in seconds."
- Launch-post claims from internal use: team saves "at least ten hours a week on data entry"; recall of previously lost deals; deal sharing reduced "from a 30-minute chore to a single click."
- No user counts, ARR, or review-platform presence (G2/Capterra) found as of this report — consistent with a months-old public product.

---

## 7. Go-to-Market

Observed motion (all from public artifacts):
1. **Founder-led content:** launch essay cross-posted to Redbud's beehiiv newsletter (VC audience) and redbud.vc; framing as an operator story rather than vendor marketing.
2. **Freemium-ish trial:** self-serve signup, 30-day trial, no sales call required — PLG posture unusual among VC tools.
3. **Price-led positioning:** explicit comparison table vs. Affinity/Attio on cost and ingestion capability.
4. **Developer surface:** API docs with MCP-friendly llms.txt suggests targeting technical operators and AI-agent workflows early.
5. **Network effects via sharing features:** trackable deal links and LP dashboards create exposure to new funds each time content is shared.

---

## 8. News Timeline

| Date | Event | Source |
|---|---|---|
| 2023–2025 (implied) | Tool developed and used internally at Redbud during high-volume sourcing period | launch blog ("started as an internal tool"; Redbud Fund I era) |
| Mar 18, 2026 | Redbud announces $25M Fund II (Axios Pro exclusive) — organizational backdrop weeks before launch | Startland News / redbud.beehiiv |
| **Mar 29, 2026** | **Public launch** of Roulette with full feature manifesto | useroulette.com/blog |
| Mar 30, 2026 | Launch essay republished to Redbud newsletter audience | redbud.beehiiv.com |
| Mid-2026 | Site live with pricing, security page (CASA Tier 2), API docs, changelog; © 2026 Roulette | site |

Note on the changelog: entries dated Sep–Oct 2025 (e.g., "Mobile app redesign," "SSO/SAML," "advanced analytics") predate the March 2026 public launch and read as generic/template content (the marketed product is web-based; no iOS/Android app is advertised anywhere else on the site). Treat changelog-derived capability claims (SAML SSO etc.) as unverified until confirmed elsewhere.

---

## 9. Competitive Positioning

**Versus Decile Hub:** Hub is a full fund operating system (CRM + admin + accounting + legal + LP portal) with a free core and services attach. Roulette deliberately does *not* do fund administration or accounting; it attacks the front-of-funnel data layer with better ingestion ergonomics and transparent pricing. A fund could plausibly run both (Roulette for deal flow, Hub/admin elsewhere), which makes Roulette simultaneously complementary to and competitive with Decile's deal-flow module.

**Versus Affinity:** Affinity's moat is passive relationship intelligence across a whole firm; Roulette concedes relationship intelligence ("Affinity is great for relationship tracking") and attacks ingestion + retention + price. Its Specter enrichment and warm-intro visibility are partial substitutes.

**Versus Attio/generic CRMs:** wins on VC-specific semantics (deck parsing, DocSend conversion, portfolio update KPI extraction, LP dashboards).

**Versus Wokelo:** Wokelo serves PE/consulting diligence depth (research reports, data APIs). Roulette stays inside the CRM/deal-management lane. Overlap is limited today but Roulette's "AI memo generation" edges toward light diligence.

**Moat assessment (analysis):** current defensibility rests on workflow lock-in (permanent historical records compound switching costs over time), the parent fund's credibility/network, and speed. Risks: ingestion is a feature incumbents (Affinity, Attio, Decile Hub) could replicate; two-person execution capacity; no disclosed capitalization; brand-name collision risk ("Roulette" collides with casino/music-venue entities in search, hurting SEO/discoverability — this research session itself hit that problem repeatedly).

---

## 10. Strengths / Weaknesses / Risks (analysis)

**Strengths**
- Sharpest single-problem focus in the category ("ingestion is the bottleneck") with a feature set that maps 1:1 to that thesis.
- Genuine dogfooding at meaningful volume (400–500 deals/mo parent fund).
- Aggressive, simple pricing; PLG self-serve motion; modern developer surface (API, MCP docs).
- Security hygiene unusually early (CASA Tier 2) for a two-person shop — signals awareness of VC buyer due-diligence checklists.
- Distribution flywheel: LP dashboards and shareable tracked links put Roulette in front of other GPs organically.

**Weaknesses / open risks**
- No disclosed funding, revenue, or customer counts; everything traction-shaped is self-reported.
- Tiny public footprint: new LinkedIn page (single-digit followers), no press coverage beyond its own channels, no third-party reviews.
- Changelog content quality control issues (template-looking entries) suggest very early marketing maturity.
- Incumbent replication risk is high; the wedge is visible and technically shallow to copy piecemeal.
- Name/searchability problems in a crowded tools market.

**Watch items**
- Whether a formal entity/round emerges (Crunchbase profile, SAFE announcement, or Redbud-related disclosure).
- Seat expansion beyond the five named logo customers.
- Whether AI credit limits (500/user/mo) become a monetization friction or expansion lever.
- Any move up-stack (fund administration/LP reporting) that would put it in Decile Hub's crosshairs directly.

---

## 11. Intelligence Gaps (could not verify)

- Legal entity name, incorporation state, and whether Roulette is owned by Redbud, its GPs, or a separate company.
- Any financing (none announced).
- Engineering team composition beyond the LinkedIn 2-person listing.
- Real customer count behind the five logos.
- Whether the Sep–Oct 2025 changelog items reflect shipped functionality or placeholder content.

---

## 12. Sources

- useroulette.com homepage (features, pricing, security/CASA badge, customer logos, footer contacts)
- useroulette.com/blog/launching-roulette-deal-management-for-vc (Mar 29, 2026)
- redbud.beehiiv.com/p/launching-roulette-deal-management-for-vcs (Mar 30, 2026)
- docs.useroulette.com (Quickstart, Companies concepts, AI endpoints, credits model)
- linkedin.com/company/useroulette (+ scraper metadata: size 2, industry Software Development)
- redbud.vc/brett-calhoun (bio); superscout.co/investor/redbud-vc (team roles)
- redbud.beehiiv.com/p/redbud-vc-raises-25m-fund-ii (Mar 18, 2026); startlandnews.com Fund II coverage (Mar 18, 2026); missouribusinessalert.com (Apr 13, 2026)
- vcsheet.com Redbud VC profiles (sourcing volume, check sizes)

*Roulette-specific performance figures ("100s of deals daily," hours saved, 4x cheaper) are company marketing claims reproduced as such.*
