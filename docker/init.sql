-- Runs once, on first boot of an empty postgres data volume. Editing this file
-- has no effect on an existing volume -- use `npm run db:reset` to re-run it.
--
-- huddle_test is the database the integration tests target, so that truncating
-- between tests can never touch development data.
CREATE DATABASE huddle_test OWNER huddle;
