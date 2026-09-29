# Family Budget: setup (about 20 minutes, once)

This app needs a small backend so both phones share the same data. The drag-and-drop upload you used for the other apps can't deploy backends. So this time the code goes into a GitHub repo, and Cloudflare deploys it from there. Everything fits in Cloudflare's free plans.

## 1. Put the code on GitHub
1. On github.com, click **New repository**, name it `family-budget`, set it to **Private** and create it.
2. Click **uploading an existing file**.
3. Unzip `family-budget.zip` on your computer, open the folder, and drag everything inside it into the upload area: the `public` and `functions` folders, `README.md`, `SETUP.md` and `.gitignore`.
4. Click **Commit changes**.

## 2. Create the database
1. In the Cloudflare dashboard, go to **Storage & Databases → D1 SQL Database → Create**.
2. Name it `family-budget-db` and create it. You don't need to run any SQL; the app creates its table itself.

## 3. Create the Pages project
1. Go to **Workers & Pages → Create → Pages → Import an existing Git repository**.
2. Connect GitHub, then pick `family-budget`.
3. Use these build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `public`
4. Save and deploy. Note your address, for example `family-budget.pages.dev`. If that name is taken, Cloudflare adds letters to it; use whatever it gives you in the steps below.
5. Go to **Settings → Bindings → Add → D1 database**:
   - Variable name: `DB`
   - Database: `family-budget-db`

## 4. Lock it to the two of you (Cloudflare Access)
1. Open **Zero Trust** from the dashboard sidebar (one.dash.cloudflare.com).
   - The first time, pick a team name, e.g. `sunday-family`, and choose the **Free** plan.
   - It may ask for a card even though the plan is free.
2. Check that **Settings → Authentication → Login methods** includes **One-time PIN**. It's there by default.
3. Go to **Access → Applications → Add an application → Self-hosted**. (In newer layouts this is under *Access controls → Applications*.)
   - Application name: `Family Budget`. Session duration: **1 month**.
   - Add the public hostname `family-budget.pages.dev`.
   - Add a second hostname `*.family-budget.pages.dev` so preview builds are covered too.
   - Policy: name `Family`, action **Allow**, include **Emails**: `alberteddy99@gmail.com` and `ruthldsk@gmail.com`.
   - Save.
4. Open the application again and copy its **Application Audience (AUD) Tag**.

## 5. Tell the app about Access
1. In your Pages project, go to **Settings → Variables and Secrets** and add these for **Production**:

   | Name | Value |
   |---|---|
   | `TEAM_DOMAIN` | `sunday-family.cloudflareaccess.com` (your team name) |
   | `POLICY_AUD` | the AUD tag you copied |
   | `PEOPLE` | `alberteddy99@gmail.com:Albert,ruthldsk@gmail.com:Ruth` |

2. Go to **Deployments**, open the latest one, and choose **Retry deployment**. Settings only apply to new deployments.

## 6. Install on both phones
1. Open the address in Safari (or Chrome on Android).
2. Enter your email, then type the code Cloudflare emails you.
3. Share → **Add to Home Screen**.
4. Ruth does the same with her email.

You'll be asked for a new code about once a month.

## Checks
- In a private browser window, the address should show the Cloudflare sign-in page. It must not show the app.
- After signing in, `https://<your-address>/api/me` should show your name.
- An email that isn't on the list gets turned away twice: by Access, and again by the app's own check.

## Using it
- **+**: add spending (amount, category, who, how it was paid), income, or money put into a savings goal.
- **Overview**: shows what's left in the budget, a rough daily amount you can spend, bills (tap **Pay** to record one), categories against their limits, who spent what, a 6-month trend, savings goals and recent entries.
- **Spending**: every entry for the period. You can search and filter it, and export it as CSV.
- **Plan**: expected income, monthly limits for each category (starts at zero, so fill these in first), bills and savings goals.
- **More**: sync status, currency, the day the budget month starts (e.g. payday on the 25th), exports and sign out.

## Offline and sync
- Each phone keeps a copy, so the app opens and works offline.
- Changes upload when you're back online. The pill at the top right shows the status.
- If you both edit the same entry, the later edit wins.
