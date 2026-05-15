# bob_sessions

**Mandatory folder per the IBM Bob Hackathon Guide (page 18–19).** Judges evaluate this submission largely on what's here.

## What goes here

For each Bob task related to the project:

1. **Screenshot** of the task session consumption summary (PNG). Open Bob IDE → Views and More Actions → History → select task → screenshot the consumption-summary card (Context Length, Task ID, Tokens, Cache, API Cost, Size).
2. **Exported task history** (Markdown). From the same panel, click the Export task history icon to download.

## File naming convention

```
YYYYMMDD-HHMM__<agent-or-area>__<short-slug>.md
YYYYMMDD-HHMM__<agent-or-area>__<short-slug>.png
```

Examples:

```
20260515-2100__cartographer__react18-changelog-ingest.md
20260515-2100__cartographer__react18-changelog-ingest.png
20260516-0830__surgeon__patch-batch-1-files-1-to-12.md
20260516-0830__surgeon__patch-batch-1-files-1-to-12.png
```

## Export procedure (from PDF guide)

1. In Bob IDE chat interface, select **Views and More Actions → History**.
2. Confirm correct workspace.
3. Click a task related to this submission.
4. Click the task header → consumption summary opens.
5. Screenshot the summary card.
6. Click the **Export task history** download icon → save the `.md` file.
7. Drop both files into this folder, named per the convention above.
8. `git add` + commit with message `chore(bob): export session — <slug>`.

## What NOT to do

- Do not commit credentials. Bob will redact, but verify the exported markdown contains no API keys before pushing.
- Do not edit the exported markdown files. Judges expect raw exports.
- Do not export sessions unrelated to the project (e.g., personal Bob tasks). Filter by workspace.

## Coverage target

By submission (Sun May 17, ~18:00 IST), this folder should contain **15–30 sessions** spanning all four agents (Cartographer, Surgeon, Examiner, Auditor) plus the orchestrator. Bob did the hard intellectual work — these reports are the proof.
