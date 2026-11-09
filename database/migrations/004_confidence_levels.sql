-- ============================================================
-- Migration 004: CONFIDENCE LEVELS (HIGH / MEDIUM / LOW)
-- Run this ONCE on your existing database (epatong_db),
-- AFTER migration 003 (admin).
--
-- It does not delete or change any old row. It only:
--   1) lets 4 columns of `scans` be empty (NULL)   -> a LOW scan has no
--      category, and a MEDIUM scan has no "condition"
--   2) adds the new confidence columns to `scans`
--   3) adds the `settings` table with the two cutoffs
-- Old scans keep NULL in the new columns (nobody judged them back then).
-- Photos are NOT stored anywhere. Only numbers and category names are.
-- ============================================================
USE epatong_db;

-- 1) These 4 columns used to be NOT NULL. "NULL" now means
--    "not identified" / "condition not checked".
ALTER TABLE scans
  MODIFY item_type        VARCHAR(100) NULL,
  MODIFY item_name        VARCHAR(255) NULL,
  MODIFY condition_status ENUM('usable','for_parts','for_disposal') NULL,
  MODIFY condition_label  VARCHAR(100) NULL;

-- 2) New columns
ALTER TABLE scans
  ADD COLUMN confidence_level ENUM('high','medium','low') NULL      AFTER confidence,
  ADD COLUMN top1_category    VARCHAR(100)  NULL                    AFTER confidence_level,
  ADD COLUMN top1_confidence  DECIMAL(5,4)  NULL                    AFTER top1_category,
  ADD COLUMN top2_category    VARCHAR(100)  NULL                    AFTER top1_confidence,
  ADD COLUMN top2_confidence  DECIMAL(5,4)  NULL                    AFTER top2_category,
  ADD COLUMN user_confirmed   BOOLEAN NOT NULL DEFAULT FALSE        AFTER top2_confidence,
  ADD COLUMN final_category   VARCHAR(100)  NULL                    AFTER user_confirmed,
  ADD INDEX idx_scans_level (confidence_level, created_at);

-- 3) SETTINGS (the two cutoffs the admin can change)
--    0.60 = 60%.  Below LOW cutoff -> LOW.  At/above HIGH cutoff -> HIGH.
--    In between -> MEDIUM.
CREATE TABLE IF NOT EXISTS settings (
  setting_key   VARCHAR(50)  PRIMARY KEY,
  setting_value VARCHAR(100) NOT NULL,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- INSERT IGNORE = never overwrites a value the admin already changed.
INSERT IGNORE INTO settings (setting_key, setting_value) VALUES
('confidence_low_cutoff',  '0.6000'),
('confidence_high_cutoff', '0.8500');
