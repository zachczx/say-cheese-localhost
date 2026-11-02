# Cubby profile

This profile covers Cubby's main screens. The 17 that the public case study uses start
selected, and the rest start cleared. Use it only against
Cubby's synthetic, manually verified QA environment. Say Cheese Localhost does not start the app
or seed its database.

## Prepare the QA environment

In `A:\cubby`, configure a disposable **screenshot QA database** in `.env.test.local`. Keep it
separate from the integration test database, because integration tests reset their database.
Then run these commands explicitly:

```powershell
just seed-test-db
just verify-test-db
just dev-test
```

`seed-test-db` wipes the configured test database. Run it only when you intend to rebuild that
disposable QA dataset. `verify-test-db` is read-only. If the seed is missing, prepare the
database before capturing.

## Capture

Select **Cubby** in Say Cheese. Its default base URL is `http://127.0.0.1:5174`, and a
customized URL is kept per profile. Confirm the synthetic household in the app before
capturing. Localhost alone does not prove an application uses safe data, and this profile does
not run an automated QA preflight.

Presets are starting points. Several shots need a step first: open a workout, an exercise or
the active illness episode, or start a saved timer. The controller displays each shot's
preparation hint. Keep manual preparation on for these views, because batch mode captures
their starting routes. Batch mode
scrolls `dashboard-recent` to Home's Recent section by itself.

Review files in Downloads before publishing them, particularly when using a private QA photo
directory. Do not point this profile at production-backed development.

## Shot list

Shots marked _case study_ start selected and follow the case study's chapter order. The
others start cleared.

1. `dashboard` — `/app` — case study
2. `dashboard-recent` — `/app`, scrolled to the Recent section — case study
3. `tasks` — `/app/tasks` — case study
4. `limits` — `/app/limits` — case study
5. `screentimer` — `/app/screentimer`, with a saved timer running — case study
6. `enrichment` — `/app/enrichment` — case study
7. `gym-workout` — `/app/workouts`, then open the latest workout — case study
8. `illness` — `/app/illness`, then open the active episode — case study
9. `sleep` — `/app/sleep` — case study
10. `coffee` — `/app/coffee` — case study
11. `meals` — `/app/meals` — case study
12. `jobs` — `/app/jobs` — case study
13. `expiry` — `/app/expiry` — case study
14. `market` — `/app/market` — case study
15. `finance` — `/app/finance` — case study
16. `growing-up` — `/app/growing-up` — case study
17. `journal-recap` — `/app/journal/recap` — case study
18. `gym-exercise` — `/app/workouts/stats/exercises`, then open an exercise
19. `moments` — `/app/journal/moments`
20. `schedule` — `/app/schedule`
21. `timeline` — `/app/timeline`
22. `calendar` — `/app/calendar`
23. `household` — `/app/household`
24. `track` — `/app/track`
25. `apps` — `/app/all`

Files use the project-prefixed sequence `cubby-01-dashboard.webp` through `cubby-25-apps.webp`,
so their order and source stay clear outside the output folder. The case study stores them
without the prefix, for example `dashboard.webp`, so rename them when copying them over.
The `gym-*` IDs and file names predate Cubby's rename to Workouts. They are kept so saved
selections still line up. Travel left Cubby in October 2026, so it has no shot.
`tests/cubby-portfolio-shots.test.ts` fails if the manifest drifts from this list.

The Home evolution archives at `/app/labs/home-evolution/*` are not included. The case study
shows them at desktop size, and they no longer change.

`manifest.json` in this folder is the hand-editable source of truth. Each build also copies it
to `dist/profiles/cubby/manifest.json` as standalone JSON.
