# Daily Log

A small website for logging your day (symptoms, meals, drinks, sleep, habits) to narrow down what's behind headaches and belly pain.

- **Today:** one tap to log a symptom, coffee or water; sheets for meals, drinks, stress, exercise and meds; an evening check-in. Step back with ‹ › to see or fill in earlier days, and tap any entry to change or delete it.
- **Month:** a bullet-journal grid, one row per day and one column per habit. Tap a square to mark it. Symptoms and sleep sit next to the habits so patterns are visible at a glance.
- **Patterns:** compares days with a symptom against days without it, and lists what shows up clearly more often before it (short sleep, dairy, skipping a habit…). It counts what lines up; it doesn't diagnose.

Plain HTML with [Alpine.js](https://alpinejs.dev) and [Tailwind CSS](https://tailwindcss.com) from a CDN, no build step. Data lives in [Supabase](https://supabase.com); hosted on GitHub Pages.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Every screen, as HTML with Alpine attributes |
| `js/app.js` | What the screens show and what each button does |
| `js/store.js` | All reads and writes to Supabase, plus date helpers |
| `js/patterns.js` | The pattern finder |
| `supabase/schema.sql` | The database tables and their privacy rules |
| `supabase/migrations/` | Changes to an existing database, run once each in order |
| `scripts/make-config.sh` | Writes `js/config.js` (Supabase URL + publishable key) |
| `.github/workflows/pages.yml` | Publishes the site to GitHub Pages on every push to `master` |

## Set up

### 1. Database (once)

In the Supabase dashboard:

1. **SQL Editor → New query**: paste `supabase/schema.sql` and run it. (A brand-new database needs only this; `schema.sql` already includes every migration.)
2. **Authentication → URL Configuration**: set **Site URL** to where the site lives, e.g. `https://balexandre.github.io/daily-log/`, and add `http://localhost:8000` under **Redirect URLs** for local testing.
3. After you've created your own account in the app, turn off **Authentication → Sign In / Providers → Allow new users to sign up**, so nobody else can make one.

Row-level security means each account only ever sees its own rows. That's why it's fine that the publishable key is visible in the website.

### Updating an existing database

When a new file appears in `supabase/migrations/`, run it once in the SQL Editor **before** pushing the code that needs it. Otherwise the live site shows a "the database has no … table yet" message until you do.

| Migration | Adds |
| --- | --- |
| `001-meal-tags.sql` | Your own meal tags |

### 2. Run it locally

`.env` needs two values (it is git-ignored):

```
SUPABASE_URL=https://<project id>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
```

Other values in `.env` (like `SUPABASE_SECRET_KEY`) are never read by the site.

```bash
bash scripts/make-config.sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

### 3. Publish on GitHub Pages

1. Add two repository secrets, `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (Settings → Secrets and variables → Actions), or with the GitHub CLI (it asks for each value):

   ```bash
   gh secret set SUPABASE_URL --repo balexandre/daily-log
   gh secret set SUPABASE_PUBLISHABLE_KEY --repo balexandre/daily-log
   ```

2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `master`. The workflow writes `js/config.js` from the secrets and publishes the site.

Never add the database password or a secret (`sb_secret_…` / `service_role`) key anywhere in this project. The website doesn't need them, and anything in the website is public.

### 4. On your iPhone

Open the site in Safari → Share → **Add to Home Screen**, and always use it from there. Your login lives in the home-screen app; Safari keeps a separate one.

## Data

- `symptoms` and `habits`: what you track (habits are the month grid's columns).
- `meal_tags`: the tags offered when logging a meal (Dairy, Gluten… plus your own). Meals store the tag names they were logged with.
- `entries`: everything logged during a day, with its time.
- `days`: one row per day: the evening check-in and the "memorable moment" note.
- `habit_marks`: an × in the grid.

**Setup → Export everything** downloads all of it as JSON. Keep exports out of this repository.
