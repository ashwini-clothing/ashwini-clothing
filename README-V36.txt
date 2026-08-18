ASHWINI CLOTHING V36
====================

IMPORTANT: This version fixes the actual order-to-customer matching problem.

1. Stop the old Ashwini server first (close the Command Prompt/PowerShell window running localhost:3000).
2. Extract this ZIP into a NEW folder.
3. Open PowerShell/Command Prompt in that new folder.
4. Run: npm install
5. Run: npm start
6. Open: http://localhost:3000
7. Sign in using the SAME mobile number used when the order was placed.
8. Open Account & Lists -> My Orders.

Do NOT run the old server at the same time. Only one Ashwini server should use port 3000.

For a reliable test:
- Add a product to cart.
- Select size.
- Checkout.
- Enter the signed-in mobile number.
- Choose COD for the easiest local test.
- Place Order.
- My Orders should immediately show the order.
- Click Track Order.
- In Admin, change status and refresh My Orders.

If an older order was already created, V36 attempts to recover it using the verified mobile number and the mobile number saved in the delivery address.
