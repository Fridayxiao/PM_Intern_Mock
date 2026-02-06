Original prompt: Use the provided internship document (keep the essence, discard the dross) to build a fun web game that simulates an AI PM internship process end-to-end; Public/Private content modes; localStorage save; 4 chapters with 4 hands-on tasks; expose window.render_game_to_text and window.advanceTime; and add Playwright-driven smoke testing.

Notes:
- Repo started empty; implemented a Vite-optional static web game MVP (works with any HTTP server).
- Private content JSON files are gitignored by default to avoid accidental commits.
- Added keyboard automation (A/B/Enter) and a background canvas so the develop-web-game Playwright client can drive the flow.
- Added AI server (OpenAI SDK + DeepSeek-compatible base URL) and an “AI 互动实验台” with scenario generation.
- Expanded to 8 tasks (2 per chapter) and added more knowledge cards.
 - Expanded to 9 tasks with A/B 设计 + 结果解读。
- Replaced “AI 互动实验台” with scene-based “协作现场” roleplay panel (Slack/会议风格对话) and added local scripted fallback when AI is unavailable.
- Expanded Chapter 4 into a fuller real-world A/B workflow: Brief -> instrumentation -> A/A+SRM quality -> staged ramp -> A/B design -> readout -> triage (13 tasks total across the game).
- Added `/api/health` health check with key detection and improved AI error handling to avoid JSON parse crashes on empty responses.
- Updated public/embedded scene bundles and cards to include richer A/B methodology and roleplay context.
- Added GitHub Pages deployment workflow at `.github/workflows/pages.yml` for static auto-publish on pushes to `main`.
- Switched Vite build base to `./` so static assets work correctly on GitHub Pages project paths.
- Updated README for distribution-first usage: Play Now first, local/AI setup optional.
- Updated A/B readout task to disable AI generation in offline mode and show explicit fallback note.

TODO:
- Install Playwright (if desired) and run `bash scripts/run_smoke_playwright.sh http://localhost:5173` (currently fails in this environment because `playwright` package is missing).
- Add per-scene “推荐知识卡” tags (currently a global modal list).
