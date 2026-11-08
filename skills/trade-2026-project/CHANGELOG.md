# Changelog

- 1.0.0 (2026-11-08): created from project report 06/11, audit verification 63/63, Dot 0+1 fix (524e610 local, 5476b49 pushed, PR blocked 403), station 24h check 07/11, NEURAL_SHADOW. Covers web, engine, station, Supabase, bot relay, NN shadow, audit, and the system edit rule.

- 1.1.0 (2026-11-08): Auto Run every 5 minutes. New section in SKILL.md, runner tools/skill-autorun-5m.js, workflow .github/workflows/station-skill-5m.yml, free AI key chain Novita then UTIM then APINEX, at most one AI call per run and only for a new REPORT worthy signal, run record as artifact kept 7 days, read-only against Supabase. Installed into the repo on branch feat/skill-autorun-5m from origin/main 4aa5716. Replay cases R6 and R7 added.
