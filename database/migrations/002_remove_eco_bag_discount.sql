-- ============================================================
-- Migration 002: remove the "Eco-Bag Discount" reward
-- Run this ONCE on a database that still contains the reward
-- (run 001 first if you haven't). New installs using the updated
-- epatong.sql do not need it.
-- ============================================================
USE epatong_db;

-- vouchers.catalog_item_id has no ON DELETE rule, so any vouchers that were
-- already redeemed for this reward must be removed before the reward itself.
DELETE v FROM vouchers v
  JOIN catalog_items ci ON ci.id = v.catalog_item_id
  WHERE ci.name = 'Eco-Bag Discount';

DELETE FROM catalog_items WHERE name = 'Eco-Bag Discount';
