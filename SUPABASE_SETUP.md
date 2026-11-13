# COCONIBZ account and order tracking setup

The site remains one project. These steps connect its customer accounts, order history, and restricted shop portal to a Supabase database.

## 1. Create a Supabase project

1. Create a project in your Supabase account and save its database password privately.
2. In **Authentication → Providers**, enable **Phone**.
3. Configure a supported SMS provider and its credentials in Supabase. SMS delivery may incur provider charges.
4. In **Authentication → URL Configuration**, set the production site URL and add the site's development URL to the allowed redirect URLs while testing.
5. Phone sign-up and SMS verification are used for registration; customers use their verified phone number and password for later sign-in.

## 2. Create the database tables and access rules

1. Open **SQL Editor → New query** in the Supabase project.
2. Copy the complete contents of `supabase-schema.sql` into the editor.
3. Run the script once and confirm it completes successfully. It creates the shop list, order tables, order-saving functions, and row-level security rules.

Do not make the order, profile, or retailer tables publicly readable. Do not disable row-level security.

## 3. Connect the site

1. In Supabase, open **Project Settings → API**.
2. Copy the project URL and the **anon / publishable** key.
3. Copy `.env.example` to `.env` in the project root and fill in the values:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
   ```

4. `.env` is ignored by Git. Never put a service-role or secret key in it; `VITE_` values are included in the browser build, so only use the public publishable key. Database policies must enforce access.
5. Run `npm install`, then `npm run dev` to start the local Vite server. For deployment, run `npm run build` and publish `dist/`.

## 4. Create the owner admin account

1. Open `account.html` on the running site.
2. Join using **+233 59 544 1825**, a name, and a password; complete the SMS code verification.
3. In Supabase **SQL Editor**, assign the owner role:

   ```sql
   update public.profiles
   set role = 'admin'
   where phone = '+233595441825';
   ```

4. Sign out and back in. The **Shop portal** link will appear in the account page and open `operations.html`. Admins can also use the legacy order-tracking page at `admin.html`.

Phone is the sign-in identifier for this site. The supplied `coconibzgh@gmail.com` address is not used by phone/password authentication.

## 5. Create and assign retailer accounts

For a new retailer, sign in as an admin and open `operations.html` -> **Retailers**. To add a location, use **Create a shop** and enter its name and address; WhatsApp, map link, and hours are optional, and the wholesale price defaults to GHS 12 per bottle. The new shop is added to the public pickup list and initialized for stock and finance tracking. Then choose it and create a one-time invite code. Share the code with the retailer. They can enter the code while signing up at `account.html`, verify their phone by SMS, and receive access to that shop. Existing customers can redeem a code from their signed-in account page.

Admins can rename a shop in the **Edit shop name** section of the **Retailers** tab. The shop ID stays unchanged, so retailer assignments and historical records remain attached; the updated display name appears in the homepage, pickup list, and operations views.

Admins can also grant access to an existing verified account by phone in the **Retailers** tab. To remove retailer access, use **Remove access** there; the account becomes a customer, while the shop listing, account, orders, stock, and financial history are retained. Unused invite codes can be revoked and replaced. Codes are shown only once.

The current shop assignments are:

| Shop | Retailer sign-in phone |
|---|---|
| Dalims Multipurpose Shop | +233 24 163 7249 |
| Fashion Scientist Couture | +233 54 958 7229 |
| Nasara Hostel | +233 24 185 5696 |
| Ellizian Shop (Legon Hostel) | +233 24 433 0356 |

The Shop 5 number, **+233 59 544 1825**, is also the owner admin number. That account remains an admin and already has all-shop access; it is not assigned a separate retailer role.

## 6. Order and sales behavior

- Customer order requests are saved as **pending** before the site opens WhatsApp. If saving fails, WhatsApp is not opened and an error is shown.
- Customers can sign in to view their own orders, filter by dates or flavor, sort them, and load older results. They can edit or cancel an order only while its status is **pending** and no payment activity has been recorded; once staff confirm it or a payment is recorded, contact COCONIBZ for help.
- Admins can view all shops, update order statuses, manage retailer access, and filter order requests.
- Retailers can view and update orders only for their assigned shop(s). Their read-only Finance tab shows only assigned-shop balances and payment history; payment entry, edits, and other retailers' finance records remain admin-only.
- The financial report counts orders marked **completed** as sales; pending, cancelled, and other in-progress requests are excluded.
- Delivery orders are recorded separately as unassigned deliveries because the site does not currently route deliveries to a specific shop.
- Order history includes customer names and phone numbers for the customer and their authorized shop/admin. Set an appropriate data-retention policy for your business.

## 7. Enable the operations dashboard

The additive migrations in `supabase/migrations/` extend the existing shops/orders database with retailer inventory, stock movements, retailer sales, finance and payment records, retailer invite codes, feedback, audit logs, customer pending-order editing/cancellation, and the operations RPCs.

For an existing project that already has the schema from `supabase-schema.sql`, apply the additive migration once. With the Supabase CLI installed and authenticated locally:

```powershell
npx supabase link --project-ref fobtkaxussjzkyrzyrxu
npx supabase migration list --remote
npx supabase db push --remote
```

Check the migration list before pushing, and do not apply the base schema a second time to an already initialized project. Alternatively, run the additive migration's SQL once in the Supabase SQL Editor. Do not commit access tokens or paste them into chat.

Open `operations.html` while signed in as an admin or assigned retailer. Access is enforced by database row-level security. Retailers see assigned-shop data and their own read-only finance balances and payment history; admins can manage stock and manual payment statuses, and view audit details. Product pricing remains GHS 12 in both the current site checkout and database order function; update both together before changing the price. Payment statuses are entered manually and do not confirm a Mobile Money transaction. Delivery orders have customer-entered addresses but are not automatically routed to a shop or deducted from shop inventory.

Retailer stock starts at zero until an admin records a restock. Retailer sales cannot exceed available inventory; the sale form shows current quantities, and the database reports the available and requested amounts if stock changes before a sale is saved. Pickup inventory is deducted when an order is marked completed; the order update is rejected if the shop lacks stock. AI performance forecasting and a public customer review form are not enabled.

## 8. Account security, photos, and homepage content

- Sign-in sessions are persisted in the browser so returning users do not need to sign in on every visit. On the sign-in form, **Remember me on this device** saves the successfully used phone number in that browser's suggestions; **Clear saved numbers** removes them. The site never saves passwords. Browser password managers may offer to save and autofill passwords; on shared devices, do not select Remember me and sign out when finished.
- All signed-in roles can open **Account & security** from their account or operations navigation to upload a profile photo or change a password. Changing a password requires the current password and signs out all devices. Profile photos are stored in a private bucket and can be viewed only by the account owner and admins.
- Admins can manage the homepage gallery and product promotions from **Operations → Marketing**. Gallery photos rotate every 20 seconds; pause/resume and manual next controls are available. Confirm permission before publishing recognizable client photos. Promotions appear on the COCONIBZ homepage and do not purchase ads on external platforms.
- The homepage weather widget asks users to request browser location, or they can enter a city instead. Coordinates or the city search are sent to Open-Meteo to retrieve weather; the site does not store them. Weather refreshes every 15 minutes while the page is open.
- Apply the additive migrations in `supabase/migrations/` to create the private profile-photo bucket, public marketing-image bucket, and gallery/promotion tables. Do not make profile photos publicly readable.

## 9. Publish a GitHub Pages test site

The intended test URL for this repository is `https://coconibzgh-eng.github.io/coconibz/`. To activate it:

1. In GitHub, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
2. Under **Settings → Secrets and variables → Actions**, add repository secrets named `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` using the project's URL and publishable anon key from Supabase **Project Settings → API**. Never use the `service_role` key. The anon key is included in the public browser bundle, so database access must remain protected by the configured row-level security policies.
3. In Supabase **Authentication → URL Configuration**, set the site URL to `https://coconibzgh-eng.github.io/coconibz/` and allow redirects matching `https://coconibzgh-eng.github.io/coconibz/**`.
4. Push to `main` or run **Actions → Deploy COCONIBZ to GitHub Pages → Run workflow**. The workflow publishes the built site; share the test URL above after the deployment succeeds.

The repository does not contain production credentials. Until Pages is enabled and both Actions secrets are configured, the public test site is not live and the workflow will not produce a working backend-connected deployment.

