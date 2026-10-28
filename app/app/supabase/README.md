# Supabase setup

1. Open the Supabase SQL Editor and run `schema.sql`.
2. In Authentication → URL Configuration, add the app's published URL and its `/#/auth/callback` route to Redirect URLs. For local development, allow `http://localhost:3000/#/auth/callback`.
3. Enable Email authentication. Email/password and magic-link sign-in both use the built-in email provider.
4. Create the first user through the app's Create account tab.
5. Promote that user in SQL Editor:

   `update public.profiles set role = 'admin' where email = 'you@example.com';`

6. Sign out and back in, then open `#/admin`.

New users receive the `member` role. Row-level security limits account and transaction reads to their owner; only admins can read all profiles and change roles. The app never uses a service-role secret in the browser.
