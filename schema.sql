-- setup.sql - Only orders table in D1
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  items TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);