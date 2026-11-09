-- ============================================================
-- Migration 001: remove the "Free E-Waste Drop-off" reward
-- Run this ONCE on a database that was created from the OLD
-- epatong.sql (one that still contains the reward). New installs
-- using the updated epatong.sql do not need it.
-- ============================================================
USE epatong_db;

-- vouchers.catalog_item_id has no ON DELETE rule, so any vouchers that were
-- already redeemed for this reward must be removed before the reward itself.
DELETE v FROM vouchers v
  JOIN catalog_items ci ON ci.id = v.catalog_item_id
  WHERE ci.name = 'Free E-Waste Drop-off';

DELETE FROM catalog_items WHERE name = 'Free E-Waste Drop-off';
