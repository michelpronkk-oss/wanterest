# SaaS source expansion map — inventory, not activation

This map distinguishes adapter code present in the repository from verified production
configuration and observed Market Coverage. The repository contains no reviewed market scope or
coverage observation set for these family/role pairs. Therefore current quantitative coverage is
**unknown**. No provider rights are declared safe here. The SEO public-source policy remains the
authority for its distinct public-projection review; unresolved sources stay unreviewed.

Complexity means the architectural work expected before a provider can safely contribute to this
family: **low** = classify existing normalized evidence and validate provenance; **medium** = add
bounded normalization/identity or provider-specific validation; **high** = new external integration,
rights review, cost controls, or private-data boundary.

| Rank | Family | Repository inventory and present gap | Expected role(s) | Rights known from repository | Complexity | Expected incremental family value |
|---:|---|---|---|---|---|---|
| 1 | `community_forum` | Reddit, Discourse, and Hacker News adapters exist. No reviewed role/family mapping or coverage rows. | Demand when a post states user need; context otherwise. | Unknown/unreviewed per source policy. | Low–medium | High: independent problem discussions and richer canonical thread coverage. |
| 2 | `developer` | GitHub, GitLab, Dev.to, and Stack Exchange adapters exist. No evidence-family/role classification; repeated issue roots need deduped attribution. | Demand for explicit requests; supply/context for project/vendor material. | Unknown/unreviewed. | Low–medium | High for software-market integration, workflow, and developer pain evidence. |
| 3 | `social` | X and Bluesky adapters exist. Family observations and content-level intent role are absent. | Demand only when explicitly evidenced; context otherwise. | Unknown/unreviewed. | Medium | High breadth and recency, with concentration and representativeness risk. |
| 4 | `reviews` | G2 and Trustpilot code exists as product-parameterized imports, explicitly ineligible for global retrieval partition reuse. No generic public market review coverage is represented. | Demand for user experience; supply/context for company-authored material. | Unknown/unreviewed; no permission inferred. | High | High purchase-friction/quality signal, subject to provider rights and product-specific constraints. |
| 5 | `video` | YouTube adapter exists. Canonical comments/threads are not represented in coverage. | Demand for user comments; context for creator/company material. | Unknown/unreviewed. | Medium | Medium–high: long-form problem stories, but thread concentration can dominate. |
| 6 | `alternative_comparison` | No dedicated comparison-source abstraction; current query planning may mention alternatives, which is not a reviewed market coverage surface. | Context by default; demand only from explicit user-authored comparison intent. | Unknown. | Medium–high | High for replacement research if independent user evidence is attributable. |
| 7 | `search_intent` | No approved search-intent corpus/connector in this foundation; Search Console is site-owner analytics, not market-wide demand evidence. | Context or demand only when source semantics prove user intent. | Unknown. | High | High potential breadth, but source semantics and rights must be established first. |
| 8 | `first_party_company` | `public-web` supports explicit URL fetch, not a broad search feed; source pages are not user demand. | Supply. | Unknown; explicit URL fetch does not imply durable reuse rights. | Medium | High for competitor offers/pricing context; never count as customer demand. |
| 9 | `broad_web` | Explicit URL fetch exists; no general broad-web search index is approved by this model. | Context; content-level demand only if independently user-generated and reviewed. | Unknown. | High | Medium–high breadth, with elevated classification and duplicate risks. |
| 10 | `launch_directory` | Product Hunt adapter exists. Provider registration does not establish market coverage or demand role. | Context/supply; demand only from qualifying user-authored discussion. | Unknown/unreviewed. | Medium | Medium: product launches/alternatives and time context. |
| 11 | `news_editorial` | No dedicated current editorial/news connector is proven by this inventory. | Context. | Unknown. | High | Medium: regulatory/category changes rather than direct customer demand. |
| 12 | `commercial_enrichment` | G2/Trustpilot product imports are not global market coverage; no other enrichment source is approved here. | Context/supply. | Unknown. | High | Medium: company/category context, with strong duplication and rights constraints. |
| 13 | `marketplace` | No ecommerce marketplace semantics or connector are being implemented in V1. | Supply/context; review-derived demand must be explicit. | Unknown. | High | Future ecommerce value; not assessed for SaaS. |
| 14 | `local_directory` | No local-business directory semantics or connector are implemented. | Supply/context. | Unknown. | High | Future local-market discovery value; not assessed for SaaS. |
| 15 | `maps_reviews` | No maps/reviews connector or local identity model is implemented. | Demand for user reviews; supply/context for listing data. | Unknown. | High | Future local reputation and location coverage value; not assessed for SaaS. |
| 16 | `owned_survey`, `owned_support`, `owned_crm`, `owned_form` | Existing workspace-owned data may exist in separate product workflows; no owned-source connector is added. | `owned_private` only. | Workspace-specific consent, retention, and permissions are unknown here. | High | Valuable private product intelligence, never global public evidence by default. |

Provider names above reflect repository adapter inventory only, not production enablement, source
health, approved rights, or current observations. A future operator must review provider-specific
rights, raw retention, canonicalization, role semantics, and source-family mapping before creating
an observation requirement or ingestion path. No provider is enabled by this document.
