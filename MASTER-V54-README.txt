ASHWINI CLOTHING V54 - MASTER WORKING PACKAGE

THIS PACKAGE IS THE MASTER BASE.
It contains the working V54 code AND the supplied working ashwini.db database.

IMPORTANT:
- Do not replace ashwini.db with a fresh database during code updates.
- Make a backup before editing code.
- For future fixes, replace only the specific code files being changed.
- Do not upload the local database to GitHub.
- For Render production, move the database to persistent storage/PostgreSQL before relying on production data.

LOCAL START:
1. Open Command Prompt in this v54sec folder.
2. Run: npm install
3. Run: npm start
4. Open http://localhost:3000

ADMIN RECOVERY:
- Run RESET-ADMIN.bat only if the admin password is unknown/broken.
- It uses ES-module syntax compatible with this project's "type": "module".
- It makes a timestamped database backup before changing the admin.
- It does not wipe the database.

CURRENT DATABASE:
- Supplied as part of this master package.
- Existing data: 2 users, 15 products, 1 order, 1 return, 11 shop categories.

PRESERVED FEATURES:
- Shop by Category filtering fix
- Existing admin/customer authentication and session system
- Customer Login & Security section
- Email/mobile profile change OTP verification
- Password change
- Password show/hide eye controls in password inputs
- Existing products/orders/returns/coupons/slides/categories
