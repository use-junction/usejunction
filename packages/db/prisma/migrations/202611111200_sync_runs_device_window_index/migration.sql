-- Snapshots only count a device usage row when a sync run from the same device
-- covers its date. This index lets that per-row EXISTS seek straight to the
-- device's runs by window end instead of scanning every run the device made.
CREATE INDEX "sync_runs_device_id_window_to_idx" ON "sync_runs"("device_id", "window_to");
