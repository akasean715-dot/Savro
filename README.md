# Ledgerly — MySQL edition

Ledgerly uses **MySQL for user accounts, passwords, bookkeeping records, inventory, invoices, plans, and admin access**. Firebase Authentication, Firebase Admin SDK, Firestore, and MongoDB are not required. Existing HTML/CSS pages are retained; authentication requests now go to the Node/Express API.

## Requirements
- Node.js 18 or newer
- MySQL 8.x (or a compatible MySQL server)

## Setup on Windows
1. Install/start MySQL Server and open MySQL Workbench or a MySQL terminal.
2. Run the SQL in `database.sql` to create the `ledgerly` database. The app creates its tables automatically on first start.
3. Copy `.env.example` to `.env`.
4. Set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE` to match your MySQL setup.
5. Replace `JWT_SECRET` with a long random secret (at least 32 characters). Set a strong `ADMIN_PASSWORD` of at least 12 characters and your preferred `ADMIN_EMAIL`.
6. In PowerShell, from the Ledgerly folder, run:
   ```powershell
   npm install
   npm run check
   npm run seed-admin
   npm start
   ```
7. Open `http://localhost:3000`. Use the admin email/password from `.env` at `http://localhost:3000/admin.html`.

## Data and security notes
- Passwords are hashed with bcrypt; plaintext passwords are never stored.
- API sessions use signed JWTs. Keep `JWT_SECRET` private and use HTTPS in production.
- The first administrator is created/promoted by `npm run seed-admin`. Do not expose `.env` or commit it to Git.
- MySQL tables are initialized by the server. The application database user should have only the privileges it needs for this database.
- Razorpay remains optional. Payment/subscription functionality requires real Razorpay test/live credentials and webhook setup before it can be considered verified.
- This migration does not import existing Firebase or MongoDB users/data. Existing Firebase passwords cannot be converted into MySQL passwords; users will need to register/reset credentials, or data must be exported and imported separately.
- Test locally before deployment. Live MySQL, email delivery, hosting, HTTPS, and Razorpay cannot be validated from this ZIP alone.


## Admin account configuration

A local `.env` file is included with the requested admin name and email/password for initial setup. Before running `npm run seed-admin`, set `MYSQL_PASSWORD` to the password for your local MySQL account. The seed command creates/promotes the admin account and stores only a bcrypt password hash in MySQL. Do not commit or share `.env`; change the initial admin password before deploying publicly.


## Email OTP password recovery (Resend)
The app supports a six-digit email OTP recovery flow. To enable delivery, add these environment variables in Render (and locally in `.env`):
- `RESEND_API_KEY`: API key from your Resend account.
- `RESEND_FROM_EMAIL`: sender address on a domain verified in Resend, e.g. `Savro Security <security@your-verified-domain.com>`.

Do not commit real API keys to GitHub or put them in frontend files. The app automatically creates the `password_reset_otps` table at startup; no manual data migration or changes to existing records are required. Without both Resend variables, requests for existing accounts return a setup error and no email is sent. Verify your sending domain and test email delivery before announcing the feature to users.
