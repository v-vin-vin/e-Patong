-- ============================================================
-- Migration 005: "Was this right?" feedback on scans
-- Run this ONCE on your existing database (epatong_db),
-- AFTER migrations 003 and 004.
--
-- It only ADDS 3 empty columns to `scans`. No old row changes.
--   user_feedback   : did the user say the result was 'right' or 'wrong'?
--   actual_category : what the user says the item really was
--                     (one of the 10 categories, or 'Not e-waste')
--   feedback_at     : when they answered
-- This lets the admin see a real accuracy number and which categories
-- get confused. Photos are still never stored.
-- ============================================================
USE epatong_db;

ALTER TABLE scans
  ADD COLUMN user_feedback   ENUM('right','wrong') NULL AFTER final_category,
  ADD COLUMN actual_category VARCHAR(100)           NULL AFTER user_feedback,
  ADD COLUMN feedback_at     TIMESTAMP              NULL AFTER actual_category,
  ADD INDEX idx_scans_feedback (user_feedback);
