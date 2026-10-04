-- Up to two receptionists may be on shift at the same time (owner, 2026-10-04); the limit is kept by the app,
-- under the reception-shift lock. One open shift per person stays (actual_shifts_one_open_per_person).
DROP INDEX IF EXISTS "actual_shifts_one_open_reception";
