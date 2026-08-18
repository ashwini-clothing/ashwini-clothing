ASHWINI CLOTHING V37
====================

This version fixes the root cause behind orders disappearing between version folders.

ROOT FIX
- Customer/order data now uses a stable Ashwini database location instead of creating a fresh database in every version folder.
- On first run, if the current folder has no database, V37 automatically looks for the newest nearby Ashwini/Vxx folder containing ashwini.db and reuses it.
- You can also set ASHWINI_DB_PATH to the exact database file if needed.

ORDER FIXES
- New orders are saved against the signed-in account and its verified mobile number.
- Checkout rejects a different mobile number instead of creating an order that cannot later be found.
- If the account has no phone yet, checkout saves the entered mobile to the account.
- My Orders and Track Order use the same account/mobile matching.
- Admin shipping status continues to update customer tracking.

IMPORTANT TEST
1. Stop the old localhost:3000 server.
2. Extract V37 into a NEW folder beside your older Ashwini version folders.
3. Open PowerShell in V37.
4. Run: npm install
5. Run: npm start
6. Open http://localhost:3000
7. Sign in with the same mobile number used for the order.
8. Open Account & Lists -> My Orders.

Do NOT delete the old Ashwini folders or their ashwini.db until the order is confirmed in V37.
