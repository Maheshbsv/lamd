# Product Requirements Document (PRD): LAMD

## 1. Product Overview
**LAMD (Local AI Memory Daemon)** is a Git-native, file-based memory and context engine designed for Claude Code. It solves the "blind collision" problem for non-technical business users and developers working collaboratively. By seamlessly syncing rules, architectural decisions, and session histories via Git, LAMD ensures AI coding agents maintain strict architectural discipline across multiple branches without requiring manual context hand-offs.

## 2. Core Objectives
* **Eliminate Context Degradation:** Ensure Claude Code instantly understands project constraints and past decisions upon initialization.
* **Frictionless Collaboration:** Rely on standard Git mechanics to merge team memory, entirely avoiding binary database conflicts (e.g., SQLite lockouts or merge failures).
* **Invisible Interface:** Operate entirely in the background via the Model Context Protocol (MCP); users interact only with the standard Claude interface.
* **Proactive Curation:** Transform the AI from a passive tool into a proactive technical lead that prompts users to document important decisions and session summaries.

## 3. Scope & MVP Features

### 3.1. Git-Native File Storage
* All memory is stored locally in a hidden `.lamd/` directory at the project root.
* Directory contents are committed to source control alongside the application code.
* Git natively handles branch isolation, context switching, and merge conflict resolution for memory files.

### 3.2. The Three Memory Layers
* **Rules (Core Guardrails):** Stored as `.md` files. Dictates unbendable constraints (e.g., "Use React," "Always use async/await").
* **Decisions (Archival Context):** Stored as `.json` files. Records specific architectural choices and their rationale.
* **Sessions (Implementation History):** Stored as Markdown with YAML frontmatter. Summarizes what was built, who built it, and pending next steps for easy hand-offs between collaborators.

### 3.3. Claude MCP Integration
* **Resources (Automation):** The system exposes `.lamd/rules/` as MCP resources, automatically injecting them into Claude's prompt at the start of every session to hard-block non-compliant requests.
* **Tools (Agency):** Exposes custom tools (`lamd_search_memory`, `lamd_save_decision`, `lamd_save_session`) allowing Claude to read historical context and write new memory files.

### 3.4. Proactive AI Triggers & Attribution
* Claude will proactively ask the user to save a decision when an architectural consensus is reached.
* Claude will proactively ask the user to generate a session summary at the end of a coding task.
* The system automatically tags saved decisions and sessions with the user's identity by fetching the local `git config user.name`.

## 4. User Workflows

### 4.1. Installation & Setup
* **Action:** User runs a single command (e.g., `npm install -g lamd-mcp`) and initializes the project.
* **Result:** The `.lamd/` folder is generated, and the MCP server is registered in the user's `claude.json` config.

### 4.2. Daily Development (Collaboration)
* **Action:** Person B checks out a new branch and asks Claude to build a feature contrary to established rules.
* **Result:** Claude ingests the rules via MCP resources, refuses the non-compliant request, explains the constraint, and offers a compliant implementation path.

### 4.3. Branch Merging
* **Action:** Person B opens a Pull Request to merge their branch into Person A's work.
* **Result:** Git seamlessly merges the code alongside the `.lamd/decisions/` and `.lamd/sessions/` files. Any conflicting changes to `.lamd/rules/` are presented as standard text conflicts for easy human review.