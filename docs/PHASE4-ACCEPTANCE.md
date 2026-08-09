# Phase 4 — Acceptance Matrix

Gate name: **MEMORY RETRIEVAL + CONTEXT GATE**

| # | Requirement | Required |
|---|-------------|----------|
| 1 | Empty retrieval → empty page | YES |
| 2 | Hard filters: tagsAny, project, lifecycle, textContains | YES |
| 3 | Order confirmedAt DESC, id ASC | YES |
| 4 | Repeated retrieve identical | YES |
| 5 | Pagination pageSize 1/2 multi-page | YES |
| 6 | No duplicate / no gap vs full ordered set | YES |
| 7 | Context assembly deterministic | YES |
| 8 | Context budget maxItems + maxChars | YES |
| 9 | Rebuild equivalence retrieve/context | YES |
| 10 | eventCount unchanged on retrieve/context/rebuild | YES |
| 11 | No new canonical UUIDs in bundles | YES |
| 12 | Desktop retrieve/context E2E long-lived PG | YES |
| 13 | FS audit | YES |
| 14 | Foundation 13/13 | YES |
| 15 | Query 9/9 | YES |
| 16 | Desktop E2E 8/8 | YES |
| 17 | Live PostgreSQL | YES |
| 18 | Failures 0 / Skipped 0 | YES |

GREEN only after physical live evidence on the exact tag SHA.
