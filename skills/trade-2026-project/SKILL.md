# Trade.2026 project

Work on the Trade.2026 coin trading project the right way, from its real code and its real live state. The project is a static web app plus a 24/7 station plus a Telegram bot. This skill tells you which part you are touching, how to check it end to end, and what never to claim.

## Trigger

- Use when the user asks about Trade.2026, about a coin signal, about the station, about the coin bot, about the audit, or about a fix wave for this project.

- Use when the user asks to check the station, to review a signal, to verify an audit finding, to fix a bug in this repo, or to push a branch and open a pull request for this repo.

- Use when the user asks for the skill to run itself every 5 minutes. That is the Auto Run mode below. It reads the station and the newest signals, reviews them, and writes a run record. It never trades and never sends a message by itself.

- Input is a question, a signal, a log, a screenshot, or a file from the repo, with the branch named when it matters.

- Output is a checked answer with the source file and line, or a finished change with tests passing, or a clear report of what is still blocked.

- Do NOT use when the user asks about the Forex and gold bot @Nexuspilot90_bot, about MT5, or about the NexusPilot dashboard. That is a different project, with a different threshold of 80, not 70.

- Do NOT use when the user asks to place a trade, to move money, or to change a live position. This skill works on the project. It never trades.

## Procedure

- Name the part first, before you touch anything. The parts are the web app, the signal engine, the station, the data layer, the bot relay, and the neural scorer. A fix in one part must not break another part silently.

- Read the project report in references before you answer a structural question. The report is BAO-CAO-DOC-DU-AN.md, read on 2026-11-06 from the real repo.

- Check the branch before you trust a file. The repo has a main branch and a data branch. The main branch copy of data can be weeks old, while the live data branch keeps updating. A claim that the station stopped must be checked against the live data branch, not against a zip of main. This exact mistake happened on 2026-11-06 and was corrected the same day.

- Check the version before you quote it. The app version is 2.17.2 in config.js. The README still says 2.0.0. The fix branch for Dot 0 plus 1 is v2.17.3. Quote the version with its source.

- Understand the web app as it is. It is a static web with no backend and no build step. One index.html file plus 28 JavaScript files in assets/js, about 10836 lines, loaded in order by script tags. All state lives in localStorage and IndexedDB in the browser. The live web address is trade-2026-tau.vercel.app. The address trade-2026.vercel.app only returns one line of test text and is not the web app.

- Understand the engine as it is. The function phanTichCoin runs on three frames in parallel: 4H, 1H, and 15m, with 260 candles per frame. The machine state has five steps: wait, scan, CHoCH, retest, and enter. Retest uses only closed candles, because open candles repaint. The confluence score is out of 100: HTF 25, POI 15, sweep 20, CHoCH 15, retest 15, and risk reward 10, plus flow, history, order block, candle, and derivatives adjustments. Entry sits at the POI edge. Stop sits after the sweep wick plus 0.25 ATR. Take profit 1 is risk reward 1 to 2. Take profit 2 is risk reward 1 to 3.

- Review a signal with the review-trade-signal skill, not by repeating its rules here. Report only at score 70 or above with phase alert ready or retest in progress. Score 50 to 69 is PREPARE only. Drop a signal older than 10 minutes. Deduplicate one coin per 60 minutes.

- Check the station end to end, never from one green run alone. The new station is GitHub Actions plus Supabase, chosen by the user on 2026-11-06. It has three workflows: collector every 15 minutes, bridge every 5 minutes, and snapshot twice a day. It writes to Supabase and to the JSON data branch at the same time. It does not change the original code.

- Check the station by its heartbeat, its last scan time, and its last signal time, not by its last run colour. GitHub schedule is best effort. It can delay or drop a run with no error. The 24 hour check on 2026-11-07 showed the 15 minute collector ran only 3 times in 24 hours, with the last scan at 07:02 and a standstill of about 6 hours, while every run was green. The old station still pushes about every 75 minutes, so keep it running until the new station proves stable.

- Check the data layer by its real rules. The Supabase project is supabase-almond-fence, reference fagveiomuwuyuzzeepvk, free plan. It has five tables: signals, whale events, liquidations, flow buckets 12h, and station heartbeat, with public read and Realtime on signals. Auth is correct only one way: send the apikey header with the secret key, and do not send an Authorization header. ClickHouse is archive only, never a Supabase replacement. The ClickHouse trial is 300 credits to 2026-12-07, with a reminder set for 2026-12-05.

- Check the bot relay by its real path. The Actions sender is a relayer, not a direct Telegram sender. It reads signals, fetches Binance public klines, and posts to the relay at bot-tele-2026.vercel.app/api/signal-relay, with header X-Signal-Key. The Flask relay sends the rich message: chart, detail card, copy ready order line, and buttons. The coin bot is @trademrbit_bot. Its token lives in the Vercel variable BOT_TOKEN_TRADEMRBIT. The SIGNAL_KEY lives in the Trade.2026 repo secrets. The coin threshold is 70 with 60 minute dedupe. The Forex bot keeps 80 with 30 minute dedupe.

- Treat the neural scorer as shadow only. It is an MLP with shape 24 to 8 to 1, feature registry dac-trung-v1. It never changes the score or the verdict. Its probability has meaning only when the status is ready. In every other status the probability is null. Train it with node tools/train-nn.js. Promote it only by hand, after at least 30 decided samples, validation accuracy above baseline, and a human approval.

- Remember the known weights mismatch. The weights file records sizes 12, 8, 1 against an architecture of 24, 8, 1, so it is likely incompatible until retrained. Check compatibility with NN.kiemTraTuongThich before you trust any NN number.

- Verify an audit finding before you plan a fix for it. The audit of 2026-11-06 has 63 findings. Verification finished 63 out of 63 on 2026-11-08: 52 correct, 8 partly correct, 1 correct but partly outdated, and 2 not bugs. The two not bugs are L-07, the 15 minute horizon is a deliberate design choice, and L-13, the heatmap adds no points. The figure 57 out of 63 from 2026-11-06 at 17:14 was withdrawn the same day, because only 16 findings had been checked then. Never use that withdrawn figure again.

- Fix in waves, only after verification is complete. Dot 0 plus 1 is done: branch fix/dot-0-1-audit, local commit 524e610, v2.17.3, 15 files, plus 482 minus 100. The branch was pushed on 2026-11-08 as commit 5476b49, with identical content to the checked local commit. Opening the pull request failed with 403, because the token lacks Pull requests permission. The user opens the pull request by hand from the compare link, or grants a token with Pull requests permission.

- Follow the system rule for every file edit in this repo. Fetch the latest main before you edit. Read the diff after you edit. Every deleted line must be deliberate and explainable. Verify a feature that connects two systems live end to end. Reverify it the same day after a deploy touches it. When the user reports that something does not run, check the whole chain from compute to send to receive.

- Run the harness from the repo root, then check git status after. Running the harness dirties data/flow-247.json and data/journal-247.json. Revert those files before you commit. The harness baseline is 641 pass and 0 fail, with the Dot 0 plus 1 behaviour test at 25 out of 25.

- Remember the live numbers and their limits. The live set is 104 signals, 39 percent win, expectancy minus 0.16. That number is not usable as proof, because the horizon is 15 minutes, old records use the wrong entry price, and expectancy here ignores fees. The real expectancy after fees is about 0.1 R per trade worse. Never quote the live numbers as a promise.

## Auto Run

- Run the skill itself every 5 minutes with tools/skill-autorun-5m.js and the workflow .github/workflows/station-skill-5m.yml. The workflow runs on cron */5, which is the shortest schedule GitHub Actions allows. GitHub schedule is best effort, so a run can delay or drop with no error. A missing run is a verdict about the schedule, not proof that the station stopped.

- Run each cycle in this order: read the latest station heartbeat, read the newest signals, review each new signal, write one run record, then stop. The run is read only against Supabase. It never writes to Supabase, never sends Telegram, never trades, and never changes a file in the repo.

- Read the heartbeat from the station_heartbeat table and the signals from the signals table, with the apikey header only and no Authorization header. Reuse tools/supabase-writer.js for both reads, because that file already carries the correct auth rule.

- Judge the station by heartbeat age: fresh means the heartbeat is younger than 20 minutes, stale means older. A stale heartbeat is reported as STALE with the age in minutes. It is never reported as proof that a signal was missed.

- Review every signal younger than 10 minutes with the review-trade-signal skill: REPORT only at score 70 or above with phase alert ready or retest in progress, PREPARE at 50 to 69, REJECT when stale, duplicate within 60 minutes per coin, or SL/TP on the wrong side. A signal with no phase in the row is NOT VERIFIED, never REPORT.

- Use a free AI key only for one optional job: a 2 line Vietnamese summary of a new REPORT worthy signal, for the advisor. Call the AI at most once per run, only when at least one REPORT worthy signal exists, and with a 20 second timeout. When the call fails for any reason, skip the summary and keep the run green. The deterministic verdict never waits for the AI.

- Pick the AI provider in this order: Novita first, UTIM second, APINEX third. Novita uses https://api.novita.ai/v3/openai with model deepseek/deepseek-v4.1-flash. UTIM uses https://api.utim.dev/v1 with the model from the UTIM_MODEL variable, and APINEX uses https://api.apinex.bond/v1 with the model from the APINEX_MODEL variable. When a model variable is unset, skip that provider and log the reason. Never invent a model id.

- Read every key from the environment only: NOVITA_API_KEY, UTIM_API_KEY, APINEX_API_KEY. When no key is set, run in deterministic mode with no AI call. That mode is a full run, not a failure.

- Write one run record per cycle as skill-run-<UTC timestamp>.json, with the heartbeat age, the signals reviewed, each verdict with its reason, the AI provider used or the reason it was skipped, and the run exit code. The workflow uploads the record as an artifact kept for 7 days.

- Exit 0 when the Supabase read worked, even when the station is STALE or no signal is new. Exit 1 only when the runner itself fails, such as Supabase unreachable after one retry, or a required variable missing outside dry run. A dry run uses mock data and makes no network call except the optional AI test call.

## Resources

- Read BAO-CAO-DOC-DU-AN.md in references for the full project read: architecture, engine, data sources, paper bot, config, tools, and risks.

- Read the audit verification file in references for all 63 findings with code evidence, including the withdrawn figure warning.

- Read NEURAL SHADOW in references for the shadow mode rules, and MRBIT NEURAL CODING in references for the P0 design.

- Read the station kit in the workspace at trade2026/supabase-station-kit for the three workflows and the sender.

- Read the patch file trade2026/dot-0-1-audit.patch for the exact Dot 0 plus 1 change, 15 files, plus 482 minus 100.

- Use the local clones at trade2026/Trade.2026-main for reading and trade2026/Trade.2026-upstream for the fix branch. Never edit a stale copy. Never upload an old file over main.

## Checks

- Branch named and checked against the live data branch when the claim is about live data.

- Version quoted with its source file.

- Signal verdict follows the review-trade-signal skill, with score, phase, timestamp, and dedupe checked.

- Station checked by heartbeat, last scan, and last signal, not by run colour alone.

- Supabase auth uses apikey only, with no Authorization header.

- NN probability appears only when the status is ready. Weights compatibility checked when a NN number is quoted.

- Audit finding quoted with its verified status out of 63, never with the withdrawn 57 out of 63 figure.

- Every file edit has a diff read, every deleted line explained, and git status clean of harness dirtied data files.

- Harness passes at baseline or better, with the Dot 0 plus 1 behaviour test at 25 out of 25 when that code is touched.

- No price or level invented. No live win rate quoted as a promise. Disclaimer not investment advice present on any signal or advice text.

- Auto Run: the heartbeat age is in the run record, every new signal has a verdict with a reason, the AI call count is at most one per run, a failed AI call never turns the run red, and the run record file exists as an artifact.

- Fix at most three rounds when a check fails, then report what is still open.

## Guard

- May do alone: read the repo, the docs, the live data branch, Supabase, and the workflow runs. Draft a fix, run the harness, and write a report.

- Needs confirmation: push a branch, open a pull request, merge, deploy, change a secret, retrain the NN, or send a signal to Telegram.

- Never do: place a trade, move money, present a signal as investment advice, invent a price or a level, paste a token or a PAT in chat or in a file, log in to GitHub with a password, or claim the station is stable from one green run.

- Never do in Auto Run: write to Supabase, send Telegram, trade, call the AI more than once per run, call the AI when no REPORT worthy signal exists, or invent a model id for UTIM or APINEX.

- Never do: edit from a stale copy, upload an old file over main, or treat a send command as proof that a message arrived.

## Learn

- Latest change: v1.1.0 on 2026-11-08, Auto Run every 5 minutes added (tools/skill-autorun-5m.js plus workflow station-skill-5m.yml, free AI key chain Novita then UTIM then APINEX, at most one AI call per run, run record as artifact). See CHANGELOG.md.

- Known lessons already baked in: check the live data branch not a zip of main, GitHub cron is best effort, Supabase auth is apikey only, NN weights mismatch 12 8 1 versus 24 8 1, harness dirties data files, and the withdrawn 57 out of 63 figure must never be reused.

- When the user corrects a fact about this project, add the correction to the Checks list or to the references file, increase the version, and rerun the trigger test.
