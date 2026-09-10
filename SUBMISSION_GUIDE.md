# SIH 2026 Submission Guide Summary

This guide outlines requirements for submitting a Smart India Hackathon 2026 project on GitHub.

## Essential Components

The submission must include actual source code, a comprehensive README addressing what problem is being solved and the proposed solution, the Problem Statement ID and title, key features, technology stack, working setup instructions, team member details, and relevant screenshots or prototype photos.

## Documentation Structure

Projects should organize files logically with source code in a `src/`-equivalent layout, documentation in `docs/`, and visual assets in `assets/screenshots/`. The README should explain "how it works" and describe "what the final output looks like."

CRQ Platform is a multi-service project, so the source code lives in per-service folders instead of a single `src/`: `frontend/` (Next.js dashboard), `backend/` (FastAPI gateway), `quant-engine/` (Monte Carlo + optimizer), `ai-agent/` (LangGraph Virtual CISO), and `blockchain/` (Solidity audit ledger). See [Repository Structure](README.md#7-repository-structure) in the README.

## Presentation & Media

As noted in the guidelines: "Upload the final PPT/PPTX to the `submission/` folder when the file size is suitable for GitHub." For oversized presentations, creators should share a viewer link via `submission/PRESENTATION.md`. Demo videos are optional but should be linked in `submission/DEMO.md` if available.

## Critical Security Requirement

The submission must exclude sensitive information. The guide explicitly states not to upload "Passwords," "API keys," "Access tokens," or ".env files containing secrets."

## Verification Step

Before finalizing, reviewers recommend testing accessibility by viewing the repository while logged out to ensure all public links and documentation are actually accessible to evaluators.
