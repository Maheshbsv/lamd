# Business Requirement Document: Local AI Memory Daemon (LAMD)

---

## 1. Executive Summary

This document outlines the business requirements for the Local AI Memory Daemon (LAMD), a local, file-based memory and context-syncing layer designed for AI coding assistants. LAMD enables multiple non-technical stakeholders to collaborate on a single codebase using AI without causing architectural drift or merge conflicts.

## 2. Problem Statement

When multiple non-technical business users collaborate on a software project using AI coding agents (such as Claude Code), they frequently experience "blind collisions." Because these users operate on separate branches without a deep technical understanding of the underlying codebase, they often instruct the AI to build features that conflict with previously established architectural rules.

Currently, AI agents lack a shared, branch-aware memory system. As a result, the AI complies with conflicting user requests, generating inconsistent code. This leads to broken features, severe merge conflicts, and unmanageable technical debt, ultimately stalling project delivery.

## 3. Business Goal

The primary goal is to build an invisible, Git-native memory layer that acts as an automated technical lead. This system will force the AI to remember project constraints, automatically share context across different feature branches, and proactively guide non-technical users to build consistent, conflict-free software.

## 4. Key Business Requirements (What We Are Trying to Achieve)

### 4.1. Zero-Friction User Experience

* **Invisible Operation:** The solution must operate entirely in the background. Business users must not be required to learn new command-line tools, manage databases, or leave their standard AI chat interface.
* **No Database Conflicts:** The system must avoid binary databases (like SQLite) that cause merge lockouts. All memory and rules must be stored as plain text or JSON files so they can be merged seamlessly using standard version control.

### 4.2. Automated Rule Enforcement (Guardrails)

* **Strict Compliance:** The system must automatically inject established project rules into the AI's core instructions at the start of every session.
* **Graceful Refusal:** If a user requests a feature that violates a core project rule, the AI must automatically refuse to write the code, explain the constraint to the user, and offer a compliant alternative.

### 4.3. Proactive Knowledge Capture

* **Automated Summaries:** The system must instruct the AI to proactively ask the user to save a "Session Summary" when a coding task is completed, ensuring a human-readable log of what was built is always available for other collaborators.
* **Decision Tracking:** When a significant architectural choice is made, the AI must proactively prompt the user to save the decision, creating a permanent, searchable record of *why* certain technical paths were chosen.

### 4.4. Branch-Aware Context Retrieval

* **Contextual Isolation:** The AI's memory must automatically align with the specific feature branch the user is currently working on. Experimental decisions made on one branch must not pollute the memory or rules of another user's branch until the two are formally merged.
* **Instant Recall:** The AI must possess a built-in search capability to instantly recall past decisions and session summaries to inform its current coding tasks.