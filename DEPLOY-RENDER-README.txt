ASHWINI CLOTHING - RENDER DEPLOYMENT

1. Upload this project to a GitHub repository.
2. In Render: New -> Web Service -> connect the GitHub repository.
3. Render can use render.yaml automatically, or set:
   Build Command: npm install
   Start Command: npm start
4. The render.yaml attaches a 1 GB persistent disk at /var/data and stores SQLite at /var/data/ashwini.db.
5. Keep secrets out of GitHub. Add environment variables in Render Dashboard (OTP/Razorpay secrets later).
6. After deployment, open the generated onrender.com URL and test login, cart, wishlist, order, admin, and PIN lookup.

IMPORTANT: Persistent SQLite storage requires a paid Render web service with a persistent disk. Without persistent storage, order/customer database changes can be lost on deploy/restart.
