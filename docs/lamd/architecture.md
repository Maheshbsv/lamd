# Architecture & System Design: LAMD

## 1. High-Level Architecture
LAMD operates as a lightweight, local Python-based MCP (Model Context Protocol) server. It completely bypasses traditional relational databases in favor of the local file system, leveraging Git for state management and branch isolation.

                ┌──────────────────────────────┐
                │     Claude Code Interface    │
                └──────────────┬───────────────┘
                               │ MCP Protocol
                ┌──────────────▼───────────────┐
                │       LAMD MCP Server        │
                │     (Python Background)      │
                └──────────────┬───────────────┘
                               │
        ┌──────────────────────┼───────────────────────┐
        │                      │                       │
┌───────▼───────┐      ┌───────▼───────┐       ┌───────▼───────┐
│  Resource     │      │ Context       │       │ Storage Writer│
│  Injector     │      │ Builder       │       │ (File I/O)    │
└───────┬───────┘      └───────┬───────┘       └───────┬───────┘
        │                      │                       │
        └──────────────────────┼───────────────────────┘
                               │
                ┌──────────────▼───────────────┐
                │ .lamd/ Directory (Git-Aware) │
                └──────────────────────────────┘

## 2. File System Schema

The system tracks knowledge via text-based files organized by intent.

* **`.lamd/rules/`**
  * Format: Plain Markdown (`01-framework.md`)
  * Purpose: Hard guardrails auto-injected as context.
* **`.lamd/decisions/`**
  * Format: JSON (`20260815-auth-flow.json`)
  * Purpose: Searchable historical rationale.
  * Fields: `decision`, `reason`, `module`, `author`, `date`
* **`.lamd/sessions/`**
  * Format: Markdown + YAML Frontmatter (`2026-08-15-session.md`)
  * Purpose: Human and AI-readable changelogs.
  * Fields: `date`, `user`, `branch`, `status`, `files_touched`.

## 3. Context Builder Engine (Search without SQLite)
The heavy lifting of context retrieval is managed in-memory using lightweight Python libraries.

### Execution Flow
1. **Trigger:** Claude invokes `lamd_search_memory(query="database schema")`.
2. **Ingestion:** The server reads all `.json` and `.md` files in the `decisions` and `sessions` folders.
3. **Tokenization & Ranking:** The text is passed through the `rank_bm25` (BM25Okapi) algorithm to assign a baseline relevance score.
4. **Time-Decay Modifier:** A recency multiplier is applied to prioritize newer architectural choices over older ones.
5. **Truncation:** The top `K` (e.g., 3-5) files are formatted into a concise string and returned to the LLM to preserve token limits.

## 4. MCP Tools & System Prompt Integration

### Core MCP Tools
| Tool Name | Input Schema | Execution Logic |
| :--- | :--- | :--- |
| `lamd_search_memory` | `{ "query": "string" }` | Runs the in-memory BM25 Context Builder. |
| `lamd_save_decision` | `{ "decision": "string", "reason": "string", "module": "string" }` | Fetches `git config user.name`, generates a timestamped `.json` file in `/decisions`. |
| `lamd_save_session` | `{ "summary": "string", "next_steps": "string", "files_touched": ["string"] }` | Fetches Git user and current branch, generates a `.md` file with YAML frontmatter in `/sessions`. |

### Prompt Engineering (The Guardrails)
To enforce discipline and proactive curation, the MCP server injects the following directives into Claude's core system prompt:

* **Rule Enforcement:** "You must read the `lamd://rules` resources. Do not write any code that violates these directives. If a user requests a violation, refuse and explain why."
* **Decision Curation:** "When an important architectural choice is finalized, proactively ask the user: 'This feels like an important architectural choice, should I save it to the project decisions?'"
* **Session Curation:** "When a coding task is completed, proactively ask the user: 'Should I generate a session summary in the `.lamd/sessions/` folder so the rest of the team knows what was implemented?'"