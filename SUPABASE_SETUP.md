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
3. Put them in `supabase-config.js`:

   ```js
   window.COCONIBZ_SUPABASE_CONFIG = Object.freeze({
     url: "YOUR_SUPABASE_PROJECT_URL",
     anonKey: "YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY",
   });
   ```

4. Never put a service-role or secret key in this website. The public key is safe to use here only because the database policies in the SQL setup restrict access.
5. Serve or deploy the entire project folder, including the new HTML, JavaScript, and SQL files. The Supabase JavaScript client is loaded from jsDelivr, so browsers need internet access to load it.

## 4. Create the owner admin account

1. Open `account.html` on the running site.
2. Join using **+233 59 544 1825**, a name, and a password; complete the SMS code verification.
3. In Supabase **SQL Editor**, assign the owner role:

   ```sql
   update public.profiles
   set role = 'admin'
   where phone = '+233595441825';
   ```

4. Sign out and back in. The **Shop portal** link will appear in the account page.

Phone is the sign-in identifier for this site. The supplied `coconibzgh@gmail.com` address is not used by phone/password authentication.

## 5. Create and assign retailer accounts

Each retailer should first join at `account.html` using their phone and verify it by SMS. Then, sign in as the owner admin, open `admin.html`, enter their phone, select their assigned shop(s), and choose **Save retailer access**.

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
- Customers can sign in to view their own orders, filter by dates or flavor, sort them, and load older results.
- Admins can view all shops, update order statuses, assign retailer access, and filter order requests.
- Retailers can view and update orders only for their assigned shop(s). They do not receive the all-shop financial summary.
- The financial report counts orders marked **completed** as sales; pending, cancelled, and other in-progress requests are excluded.
- Delivery orders are recorded separately as unassigned deliveries because the site does not currently route deliveries to a specific shop.
- Order history includes customer names and phone numbers for the customer and their authorized shop/admin. Set an appropriate data-retention policy for your business.

