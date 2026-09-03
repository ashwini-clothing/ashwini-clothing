
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'customer',
 two_step_enabled INTEGER NOT NULL DEFAULT 0,
 two_step_channel TEXT NOT NULL DEFAULT 'AUTO',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pending_registrations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 token_hash TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 email TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 phone TEXT NOT NULL,
 whatsapp_marketing_opt_in INTEGER NOT NULL DEFAULT 0,
 email_otp_hash TEXT NOT NULL,
 email_otp_expires_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 category TEXT NOT NULL,
 size_options TEXT NOT NULL DEFAULT 'S,M,L,XL',
 color TEXT NOT NULL DEFAULT 'Black',
 price INTEGER NOT NULL,
 mrp INTEGER NOT NULL,
 rating REAL NOT NULL DEFAULT 0,
 emoji TEXT DEFAULT '👕',
 image TEXT DEFAULT '',
 gallery TEXT DEFAULT '',
 stock INTEGER NOT NULL DEFAULT 0,
 description TEXT DEFAULT '',
 badge_text TEXT DEFAULT 'Ashwini Choice',
 offer_text TEXT DEFAULT '',
 offer_discount REAL DEFAULT 0,
 packed_weight_kg REAL NOT NULL DEFAULT 0.5,
 packed_length_cm REAL NOT NULL DEFAULT 25,
 packed_breadth_cm REAL NOT NULL DEFAULT 20,
 packed_height_cm REAL NOT NULL DEFAULT 5,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,
 total INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'PAYMENT_PENDING',
 payment_status TEXT NOT NULL DEFAULT 'PENDING',
 payment_method TEXT NOT NULL DEFAULT 'RAZORPAY',
 razorpay_order_id TEXT,
 razorpay_payment_id TEXT,
 razorpay_signature TEXT,
 razorpay_refund_id TEXT DEFAULT '',
 refund_status TEXT DEFAULT '',
 refund_amount INTEGER DEFAULT 0,
 refund_requested_at TEXT DEFAULT '',
 dispute_id TEXT DEFAULT '',
 dispute_status TEXT DEFAULT '',
 dispute_reason TEXT DEFAULT '',
 address TEXT NOT NULL,
 delivery_name TEXT DEFAULT '',
 delivery_address_line TEXT DEFAULT '',
 delivery_city TEXT DEFAULT '',
 delivery_state TEXT DEFAULT '',
 delivery_pincode TEXT DEFAULT '',
 shiprocket_order_id TEXT DEFAULT '',
 shiprocket_shipment_id TEXT DEFAULT '',
 shiprocket_awb TEXT DEFAULT '',
 shiprocket_courier_id TEXT DEFAULT '',
 shiprocket_status TEXT DEFAULT '',
 shiprocket_label_url TEXT DEFAULT '',
 shipment_weight_kg REAL DEFAULT 0,
 shipment_length_cm REAL DEFAULT 0,
 shipment_breadth_cm REAL DEFAULT 0,
 shipment_height_cm REAL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 replacement_for_order_id INTEGER DEFAULT NULL,
 replacement_for_return_id INTEGER DEFAULT NULL,
 return_refund_enabled INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS order_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 product_id INTEGER NOT NULL,
 size TEXT NOT NULL,
 quantity INTEGER NOT NULL,
 unit_price INTEGER NOT NULL,
 FOREIGN KEY(order_id) REFERENCES orders(id),
 FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS product_reviews (
 id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, user_id INTEGER NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), feedback TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_highlights (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, value TEXT NOT NULL, active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS behavior_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 session_id TEXT NOT NULL,
 user_id INTEGER,
 event_type TEXT NOT NULL,
 product_id INTEGER,
 context_product_id INTEGER,
 metadata TEXT NOT NULL DEFAULT '{}',
 consent_version TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
 FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_behavior_session_time ON behavior_events(session_id,created_at);
CREATE INDEX IF NOT EXISTS idx_behavior_product_type ON behavior_events(product_id,event_type);

CREATE TABLE IF NOT EXISTS security_alerts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 alert_key TEXT NOT NULL,
 severity TEXT NOT NULL DEFAULT 'HIGH',
 alert_type TEXT NOT NULL,
 order_id INTEGER,
 title TEXT NOT NULL,
 details TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'OPEN',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 resolved_at TEXT DEFAULT '',
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_security_alert_status_time ON security_alerts(status,created_at);
CREATE INDEX IF NOT EXISTS idx_security_alert_key_time ON security_alerts(alert_key,created_at);

CREATE TABLE IF NOT EXISTS razorpay_refunds (
 refund_id TEXT PRIMARY KEY,
 order_id INTEGER NOT NULL,
 payment_id TEXT NOT NULL,
 amount_paise INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'PENDING',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_razorpay_refunds_order ON razorpay_refunds(order_id,status);

CREATE TABLE IF NOT EXISTS shiprocket_webhook_events (
 event_hash TEXT PRIMARY KEY,
 awb TEXT NOT NULL DEFAULT '',
 shipment_status TEXT NOT NULL DEFAULT '',
 received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public_rate_limits (
 key_hash TEXT PRIMARY KEY,
 bucket TEXT NOT NULL,
 window_start INTEGER NOT NULL,
 request_count INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS returns (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 user_id INTEGER NOT NULL,
 reason TEXT NOT NULL,
 request_type TEXT NOT NULL DEFAULT 'REPLACEMENT',
 replacement_size TEXT DEFAULT '',
 replacement_color TEXT DEFAULT '',
 pickup_at TEXT DEFAULT '',
 admin_note TEXT DEFAULT '',
 replacement_order_id INTEGER DEFAULT NULL,
 status TEXT NOT NULL DEFAULT 'REQUESTED',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS return_refund_access_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 user_id INTEGER NOT NULL,
 reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 admin_note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_return_refund_access_pending ON return_refund_access_requests(order_id,user_id) WHERE status='PENDING';
