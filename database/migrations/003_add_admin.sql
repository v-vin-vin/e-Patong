-- ============================================================
-- Migration 003: ADMIN feature
-- Run this ONCE on your existing database (epatong_db).
-- New installs using the updated epatong.sql do not need it.
--
-- It only ADDS things. It does not delete or change any old data:
--   1) users.role            -> who is an admin (everyone starts as 'user')
--   2) ewaste_categories     -> the 10 categories' peso values + points
--                               (copied from the numbers that were in scan.js)
--   3) admin_logs            -> a record of what admins did and when
-- ============================================================
USE epatong_db;

-- 1) ROLE -----------------------------------------------------
-- Every existing user automatically gets 'user'.
-- Nobody becomes 'admin' unless you run the UPDATE in the
-- "How to make the first admin" step.
ALTER TABLE users
  ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user' AFTER avatar;

-- 2) E-WASTE CATEGORIES ---------------------------------------
-- item_name is the SAME name used by the AI model, scans.item_name
-- and the old EWASTE_DATA object. The admin can change the numbers,
-- but cannot add or delete categories (the AI model has exactly 10).
CREATE TABLE IF NOT EXISTS ewaste_categories (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  item_name       VARCHAR(100)  NOT NULL UNIQUE,
  scrap_value_min DECIMAL(10,2) NOT NULL,
  scrap_value_max DECIMAL(10,2) NOT NULL,
  points          INT UNSIGNED  NOT NULL DEFAULT 0,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- INSERT IGNORE = if a category already exists, skip it
-- (so running this again never overwrites the admin's changes).
INSERT IGNORE INTO ewaste_categories (item_name, scrap_value_min, scrap_value_max, points) VALUES
('Mobile Phone',     50,  200,  50),
('Laptop',          200,  800, 150),
('Tablet',          100,  400,  80),
('Battery',          15,   50,  30),
('Charger/Adapter',  10,   40,  20),
('Circuit Board',   100,  400, 100),
('Monitor/Display', 150,  500, 120),
('Keyboard',         20,   80,  25),
('Mouse',            10,   40,  15),
('Television',      200,  600, 130);

-- 3) ADMIN LOG ------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_logs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  admin_id    INT NULL,
  action      VARCHAR(50)   NOT NULL,   -- e.g. reward_created, voucher_marked_used
  target_type VARCHAR(50)   NOT NULL,   -- reward | category | voucher
  target_id   INT NULL,
  details     VARCHAR(1000),            -- plain-words description of the change
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_admin_logs_created (created_at)
);
