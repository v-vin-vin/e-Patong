-- ============================================================
-- e-Patong Database Schema
-- Run this in phpMyAdmin or MySQL CLI
-- ============================================================

CREATE DATABASE IF NOT EXISTS epatong_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE epatong_db;

-- ── USERS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  google_id    VARCHAR(255) UNIQUE NOT NULL,
  name         VARCHAR(255) NOT NULL,
  email        VARCHAR(255) UNIQUE NOT NULL,
  avatar       VARCHAR(500),
  role         ENUM('user','admin') NOT NULL DEFAULT 'user',
  points       INT DEFAULT 0,
  total_scans  INT DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── SCANS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scans (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          INT,
  item_type        VARCHAR(100) NULL,           -- NULL = item not identified (LOW scan)
  item_name        VARCHAR(255) NULL,           -- NULL = item not identified (LOW scan)
  condition_status ENUM('usable','for_parts','for_disposal') NULL,  -- NULL = condition not checked
  condition_label  VARCHAR(100) NULL,           -- NULL = condition not checked
  scrap_value_min  DECIMAL(10,2),
  scrap_value_max  DECIMAL(10,2),
  points_earned    INT DEFAULT 0,
  confidence       DECIMAL(5,2),
  confidence_level ENUM('high','medium','low') NULL,   -- decided by the SERVER
  top1_category    VARCHAR(100) NULL,
  top1_confidence  DECIMAL(5,4) NULL,
  top2_category    VARCHAR(100) NULL,
  top2_confidence  DECIMAL(5,4) NULL,
  user_confirmed   BOOLEAN NOT NULL DEFAULT FALSE,     -- MEDIUM: did the user pick a guess?
  final_category   VARCHAR(100) NULL,                  -- the category we finally used
  user_feedback    ENUM('right','wrong') NULL,         -- "Was this right?" answer
  actual_category  VARCHAR(100) NULL,                  -- what the user says it really was
  feedback_at      TIMESTAMP NULL,
  is_guest         BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_scans_level (confidence_level, created_at),
  INDEX idx_scans_feedback (user_feedback)
);

-- ── CATALOG ITEMS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog_items (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  points_required INT NOT NULL,
  reward_type     ENUM('gcash','eload','voucher','discount') NOT NULL,
  reward_value    VARCHAR(100),
  emoji           VARCHAR(10) DEFAULT '🎁',
  stock           INT DEFAULT -1,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── VOUCHERS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vouchers (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  catalog_item_id INT NOT NULL,
  code            VARCHAR(50) UNIQUE NOT NULL,
  status          ENUM('unused','used','expired') DEFAULT 'unused',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  redeemed_at     TIMESTAMP NULL,
  expires_at      TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id)
);

-- ── E-WASTE CATEGORIES (admin can edit the numbers) ──────────
CREATE TABLE IF NOT EXISTS ewaste_categories (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  item_name       VARCHAR(100)  NOT NULL UNIQUE,
  scrap_value_min DECIMAL(10,2) NOT NULL,
  scrap_value_max DECIMAL(10,2) NOT NULL,
  points          INT UNSIGNED  NOT NULL DEFAULT 0,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── ADMIN LOG (what admins did, and when) ─────────────────────
CREATE TABLE IF NOT EXISTS admin_logs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  admin_id    INT NULL,
  action      VARCHAR(50)   NOT NULL,
  target_type VARCHAR(50)   NOT NULL,
  target_id   INT NULL,
  details     VARCHAR(1000),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_admin_logs_created (created_at)
);

-- ── SETTINGS (confidence cutoffs the admin can change) ───────
CREATE TABLE IF NOT EXISTS settings (
  setting_key   VARCHAR(50)  PRIMARY KEY,
  setting_value VARCHAR(100) NOT NULL,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO settings (setting_key, setting_value) VALUES
('confidence_low_cutoff',  '0.6000'),
('confidence_high_cutoff', '0.8500');

-- ── SEED: E-WASTE CATEGORIES ──────────────────────────────────
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

-- ── SEED: CATALOG ITEMS ───────────────────────────────────────
INSERT INTO catalog_items (name, description, points_required, reward_type, reward_value, emoji) VALUES
('₱20 GCash Credit',         'Redeem for a ₱20 GCash wallet credit voucher code.',          200,  'gcash',    '₱20',     '💚'),
('₱50 GCash Credit',         'Redeem for a ₱50 GCash wallet credit voucher code.',          450,  'gcash',    '₱50',     '💚'),
('₱100 GCash Credit',        'Redeem for a ₱100 GCash wallet credit voucher code.',         850,  'gcash',    '₱100',    '💚'),
('₱20 E-Load',               'Prepaid load for any network (Globe, Smart, DITO).',          180,  'eload',    '₱20',     '📱'),
('₱50 E-Load',               'Prepaid load for any network (Globe, Smart, DITO).',          400,  'eload',    '₱50',     '📱'),
('₱200 GCash Credit',        'Redeem for a ₱200 GCash wallet credit voucher code.',        1600,  'gcash',    '₱200',    '💚');
