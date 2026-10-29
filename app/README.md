# Mellora

An online-banking interface built with React, JavaScript, Vite, and Supabase. It includes a splash screen, marketing site, email/password and magic-link authentication, a member dashboard with live local time and notifications, admin-managed deposit instructions, step-by-step transfer requests with sequential code-fee verification, an admin workspace with balance and messaging controls, row-level security, and animated processing states.

> New profiles receive two zero-balance accounts and no sample transactions. Administrators set balances from the admin workspace; each signed balance difference feeds recent activity and full transaction history. Money in totals only admin balance increases. Money out includes approved or completed withdrawal requests plus current Processing and Pending commitments, which are also reserved from the displayed available balance.

## Run on a Windows laptop

### 1. Install the required software

- Install the current **Node.js LTS** release from <https://nodejs.org/>. The Node installer also installs npm.
- Optionally install **Visual Studio Code** from <https://code.visualstudio.com/> to edit the project.
- Git is only needed if you use Git to obtain the project; it is not required for an extracted ZIP.

Open **PowerShell** after installing Node and check:

```powershell
node --version
npm --version
```

### 2. Extract and open the project

Download/export the website project from Kimi, extract the ZIP, and open PowerShell in the project folder. Alternatively:

```powershell
cd "$HOME\Downloads\your-extracted-project-folder"
```

The folder should contain `package.json`, `src`, `index.html`, and `supabase`.

### 3. Configure Supabase

Copy the public environment template:

```powershell
copy .env.example .env
notepad .env
```

Fill in the two values from your Supabase project:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

Use only the browser-safe **anon/public or publishable key**. Never put a service-role secret in `.env` or browser code. Restart the development server after changing `.env`.

### 4. Install and run

```powershell
npm install
npm run dev
```

Open <http://localhost:3000/>. You do **not** need to install React, Vite, or Supabase globally; `npm install` installs the project dependencies locally.

For a production check:

```powershell
npm run build
npm run preview
```

## Supabase dashboard setup

Complete these steps before creating the first account:

1. Open the Supabase **SQL Editor** and run `supabase/schema.sql`.
2. Under **Authentication → URL Configuration**, allow:
   - `http://localhost:3000/#/auth/callback`
   - `http://127.0.0.1:3000/#/auth/callback`
   - Your published app origin followed by `/#/auth/callback`
3. Under the email provider settings, enable email authentication. Keep **Confirm email** enabled for a real deployment.
4. Create the first user through the app's **Create account** tab.
5. Promote that user in SQL Editor, replacing the email address:

   ```sql
   update public.profiles
   set role = 'admin'
   where email = 'you@example.com';
   ```

6. Sign out and back in, then open `#/admin`.

New users receive the `member` role. Row-level security limits account, transaction, and notification reads to their owner. Only admins can read all profiles, change roles, update account balances, and send member notifications. Balance changes automatically create a notification for the account owner.

### Update an existing Mellora database

If you installed an earlier version of `schema.sql`, run `supabase/dashboard-update.sql` once in the Supabase SQL Editor. This non-destructive update adds the notifications table, notification triggers and policies, and admin balance-update permissions. It does not remove existing users, accounts, or transactions.

Then run `supabase/account-movements.sql` once if you have not already installed it. This legacy update adds the admin balance-adjustment function used by the admin workspace.

Finally, run `supabase/payment-requests.sql` once. This non-destructive update adds:

- `deposit_settings` for the admin-managed recipient account, required amount, payment context, and instructions.
- `withdrawal_accounts` for member recipient details that are saved and reloaded.
- `withdrawal_requests` for pending requests after amount, preview, and four-serial-code entry.
- The ownership-checked `submit_withdrawal_request` function and row-level security policies.

The update removes the old member `process_account_movement` function. Deposits now display instructions without changing balances. Withdrawals remain pending and do not debit balances or create completed transactions automatically. Withdrawal requests store a SHA-256 digest rather than the submitted code sequence.

After installing that update, run `supabase/member-admin-controls.sql` once. This adds per-user deposit instructions, individual serial-code sets and amounts, member activity tracking, and admin read access to individual notifications. Existing shared deposit settings are copied to each member before the shared table is retired.

The admin home page contains the user directory. Select a user to manage their profile, role, balances, deposit instructions, notifications, transfer authorization, activity, or deletion. Each of the four authorization codes has its own admin-entered fee; the transfer amount is independent of those fees. Codes become single-use after a successful request, and administrators can reset both the codes and amounts.

Next, run `supabase/sequential-withdrawal-codes.sql` once. This upgrade adds:

- Four separate member verification pages. Each code must match before the next page opens, and every confirmation appears in the admin activity feed.
- An automatic fee of **2.5% of each code amount** and a fixed reason for each fee. Admins do not enter fees or reasons. Fees are displayed separately and do not change the withdrawal amount.
- Optional bank branch and account type fields in individual deposit instructions.
- Individual copy buttons for newly generated admin serial codes.

Administrators are redirected to `#/admin` if they try to open the member dashboard, deposit page, or withdrawal page. Their sidebar contains only the admin dashboard.

Finally, run `supabase/redefined-transfer-codes.sql` once after the sequential-code upgrade. This current transfer workflow:

- Allows any positive transfer amount up to the selected account's available balance. The amount no longer needs to equal the combined code amounts.
- Treats each admin-entered code amount as that code's fee. The four fees are shown separately and are not added to the transfer amount.
- Names the codes Identity Verification, Recipient Confirmation, Security Authorization, and Transfer Release, with an explanation on each page.
- Saves a matching code's `paid_at` timestamp in Supabase and displays its fee as Paid to both the member and administrator.
- Requires codes 1 through 4 in order, preserves paid progress if the member leaves, and consumes the code set only after final submission.
- Lets each member save multiple recipient accounts. Saved accounts appear before the new-account form.
- Keeps every completed request pending: no automatic balance debit or completed transaction is created.

For a fresh installation, the complete `supabase/schema.sql` already includes this migration. For an existing installation, do not rerun the whole schema; run only the upgrade files you have not installed yet.

Next, run `supabase/zero-balance-dashboard.sql` once. This update:

- Creates new member accounts at **0.00** with no sample transactions.
- Keeps admin balance updates, recent activity, and full history on the same signed transaction ledger. Money in sums only positive admin adjustments; Money out sums only approved or completed withdrawal requests, excluding other spending and pending requests.
- Removes only untouched original sample balances and their five original sample transactions. Profiles with admin adjustments or other activity are left unchanged.
- Adds desktop links for Dashboard, Deposit, and Transfer, plus an accessible mobile hamburger menu. Admin navigation remains limited to the admin dashboard.

Next, run `supabase/persistent-admin-codes.sql` once. This update:

- Saves each newly generated code with its individual member in `member_serial_codes` while retaining the verification hash.
- Returns saved codes through the admin-checked `admin_get_member_serial_codes` function whenever that member's management page is opened or refreshed.
- Displays the saved code, name, purpose, fee, paid timestamp, and used timestamp with individual-copy and copy-all controls.
- Keeps direct table access revoked from browser roles and never returns code values through member functions. Codes generated before this upgrade are hash-only and cannot be recovered; reset that member's code set once to save retrievable codes.

Next, run `supabase/withdrawal-methods.sql` once. This update:

- Adds dashboard shortcuts and saved recipient details for Bank transfer, PayPal, USDT, Cash App, Wise, and Venmo.
- Supports USDT wallet addresses on TRC20, ERC20, and BEP20, with the selected network saved alongside each wallet.
- Filters saved details by method, validates method-specific fields, and retrieves them when that transfer page is reopened.
- Keeps the available-balance check, transfer preview, four ordered serial-code pages, and individual fee display for every method.
- Saves the selected method and network on the pending withdrawal request. No external payout is executed and no balance is debited automatically.

Next, run `supabase/resume-transfer-drafts.sql` once. This update:

- Creates one resumable transfer draft per member and withdrawal method.
- Saves the original recipient reference, funding account, amount, serial-code page, and four per-method confirmation flags when serial-code entry begins.
- Reopens that method directly at its saved serial-code page when selected again, while first-time methods still open their recipient-details form.
- Keeps Bank, PayPal, USDT, Cash App, Wise, and Venmo progress independent. Entered serial-code values are never stored in the draft.
- Removes a method's draft after successful pending-request submission so a new transfer can be started.

Next, run `supabase/persistent-code-countdown.sql` once. This update:

- Adds a nullable `next_code_available_at` timestamp to each member + withdrawal-method draft.
- Skips every paid code page and opens only the first unpaid code, using both saved draft confirmations and Supabase's paid-code records.
- Shows the Mellora splash after a successful code, then a 30-minute countdown before codes 2, 3, and 4. The fourth code goes directly to final pending-request submission without another countdown.
- Restores the remaining delay after refresh, navigation, or closing and reopening the browser; routine draft updates preserve the original unlock timestamp instead of starting a new 30 minutes.
- Keeps countdowns independent across Bank, PayPal, USDT, Cash App, Wise, and Venmo. Entered serial-code values are still never stored.

Next, run `supabase/member-transfer-status-notifications.sql` once. This update:

- Adds Processing transfers and Pending transfers to the member overview, sidebar, dedicated status views, and recent activity. Processing starts when a new transfer draft enters authorization; it moves to Pending when all confirmations are complete. Saved pending requests are included without double-counting a matching authorized draft.
- Expands the allowed member-activity types for method selection, draft resumption, processing, and pending transitions.
- Creates a notification for every recorded member activity, including direct database activity created by transfer submission and authorization verification. Transfer, balance, admin-message, and general activity notifications retain their own types.
- Adds dismissible toast feedback for member authentication, dashboard refreshes, recipient saves, transfer status changes, deposit copying, notification updates, and errors.

Next, run `supabase/method-transfer-codes.sql` once. This update:

- Makes authorization codes, fees, Paid/Unpaid state, and verification independent for every member and payment method. Existing code sets are preserved as Bank transfer sets.
- Creates a resumable draft when the member reaches Preview, so that method appears in their admin area. Methods that have not been previewed do not appear.
- Adds a separate admin page for each previewed method, with saved codes, individual fee amounts, paid status, and generation/reset controls.
- Resets only the selected method when its codes are regenerated: all four become unpaid, its confirmations return to the first step, and its countdown clears. Other methods remain unchanged.
- Enforces strict sequential verification for the current method and consumes only that method's paid codes during final submission.
- Keeps preview-only drafts out of Processing. Processing still begins only when the member enters authorization, then moves to Pending after all confirmations.

For a fresh installation, the complete `supabase/schema.sql` already includes these updates. Existing databases should run only the targeted migrations.

### Current balance and admin interface behavior

The latest interface update requires **no additional SQL migration**:

- Available balance subtracts current Processing and Pending commitments from the account total. Money out includes those commitments as well as approved or completed withdrawal requests.
- Processing and Pending cards appear on the dashboard only when their respective totals are greater than zero.
- The transfer form calculates each funding account's remaining unreserved balance and rejects amounts above it. The current method's existing draft does not reserve against itself while being edited; other authorized drafts and pending requests remain reserved.
- Transfer Preview omits the authorization-fee row and explains that continuing opens authorization and reserves the amount without making an external payout.
- Each member overview links to dedicated Deposit settings, Account balances, Notifications, Member activity, and Transfer authorization pages. The same destinations appear in contextual desktop and mobile sidebar navigation.
- Admin refreshes, balance updates, deposit saves, message sends, code generation/reset, copying, validation failures, and deletion outcomes use dismissible toast feedback.
- Member deletion requires an explicit `{ "deleted": true }` response from the deployed `delete-member` Edge Function. Failures keep the administrator on the member page and re-enable the deletion control; success returns to the member directory.

### Deploy secure Supabase Edge Functions

Two server-side functions are included under `supabase/functions`:

- `deposit-clicked` emails the configured administrator when a member clicks Deposit.
- `delete-member` verifies the caller's admin role and permanently deletes the selected auth user. The service-role key remains inside Supabase and is never sent to the browser.

Install the Supabase CLI if needed, then run these commands from the project folder. Replace the placeholder values with your own project and Resend settings:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set RESEND_API_KEY=re_your_key ADMIN_NOTIFICATION_EMAIL=admin@example.com DEPOSIT_EMAIL_FROM="Mellora <notifications@your-verified-domain.com>"
npx supabase functions deploy deposit-clicked
npx supabase functions deploy delete-member
```

Use a sender address on a domain verified in Resend. `ADMIN_NOTIFICATION_EMAIL` is the inbox that receives deposit-click emails. If email configuration is missing, the member can still open the deposit page and the click remains visible in the admin activity feed, but no email is sent. Member deletion requires the `delete-member` function to be deployed.

**Never add `SUPABASE_SERVICE_ROLE_KEY` to `.env`, Vite, or browser code.** Supabase supplies it only to the deletion Edge Function's server environment.

## Fix common connection and email errors

### Browser asks for proxy credentials

A Windows/Chrome proxy dialog is **not** a Mellora or Supabase sign-in form. Do not enter your Mellora password there.

If you did not intentionally configure a proxy:

1. Open **Windows Settings → Network & internet → Proxy**.
2. Turn off **Use a proxy server**. You can leave **Automatically detect settings** enabled.
3. Temporarily disable any VPN or proxy browser extension, then reload the page.
4. If the network is managed by a school or employer, ask its administrator whether proxy credentials are required.
5. Try another network, such as a mobile hotspot, to confirm whether the original network is blocking the request.

### `email rate limit exceeded`

Supabase's built-in email service is for testing and currently permits only **2 emails per hour**. Repeated clicks will not clear the limit.

- Wait for the limit to reset before trying again; or
- Configure a custom SMTP provider in Supabase's **Authentication settings**. Supabase supports providers such as Resend, AWS SES, Postmark, SendGrid, ZeptoMail, and Brevo. Follow <https://supabase.com/docs/guides/auth/auth-smtp>.
- Email-sending and authentication limits can be reviewed under **Authentication → Rate Limits**. See <https://supabase.com/docs/guides/auth/rate-limits>.

For a disposable local demo only, you can turn off **Confirm email** in the email provider settings to avoid confirmation emails. Keep confirmation and custom SMTP enabled for production.

### Tables or profiles are missing

Run `supabase/schema.sql` **before** creating users. The `handle_new_user` trigger creates profiles and zero-balance accounts only for users created after the trigger is installed. If you created users first, create a fresh test user after installing the schema or backfill the missing profile deliberately in SQL.

## Security reminder

Never share screenshots containing passwords, service-role keys, access tokens, or SMTP credentials. If a password has appeared in a screenshot, change it before continuing.
