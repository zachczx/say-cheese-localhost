# Cubby profile

This profile captures the 16 screens used by the public Cubby case study. Use it only against
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

Presets are starting points. For the gym shots, open the workout or exercise you want to show
before capturing. The controller displays each shot's preparation hint. Keep manual preparation
on for these views, because batch mode captures their starting routes.

Review files in Downloads before publishing them, particularly when using a private QA photo
directory. Do not point this profile at production-backed development.

## Shot list

The case study consumes these screenshots in this editorial order:

1. `dashboard` — `/app`
2. `tasks` — `/app/tasks`
3. `limits` — `/app/limits`
4. `screentimer` — `/app/screentimer`
5. `enrichment` — `/app/enrichment`
6. `gym-workout` — `/app/gym`, then drill into the first workout
7. `gym-exercise` — `/app/gym/stats/exercises`, then drill into the first exercise
8. `illness` — `/app/illness`
9. `coffee` — `/app/coffee`
10. `meals` — `/app/meals`
11. `expiry` — `/app/expiry`
12. `market` — `/app/market`
13. `finance` — `/app/finance`
14. `travel` — `/app/travel`
15. `growing-up` — `/app/growing-up`
16. `journal-recap` — `/app/journal/recap`

Files use the project-prefixed sequence `cubby-01-dashboard.webp` through
`cubby-16-journal-recap.webp`, so their order and source stay clear outside the output folder.
`tests/cubby-portfolio-shots.test.ts` fails if the manifest drifts from this list.

`manifest.json` in this folder is the hand-editable source of truth. Each build also copies it
to `dist/profiles/cubby/manifest.json` as standalone JSON.
