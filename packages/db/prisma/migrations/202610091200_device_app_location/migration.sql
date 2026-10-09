-- Record where each macOS agent runs from so the dashboard can flag pre-unhide
-- installs (running from the hidden ~/.usejunction app bundle) and prompt a
-- repair. Values: "visible" (~/Applications) or "legacyHidden". Null on
-- non-macOS devices and agents too old to report it. Additive and nullable, so
-- it is safe to apply online with no backfill.
ALTER TABLE "devices" ADD COLUMN "app_location" TEXT;
