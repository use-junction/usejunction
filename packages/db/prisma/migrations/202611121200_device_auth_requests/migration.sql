-- Requests from a device to be connected by approving a short code in the
-- browser, so installing no longer needs an enroll token copied from the site.
-- The agent holds the device code (stored hashed); the person approving sees
-- only the user code. New table, so it is safe to apply online.
CREATE TABLE IF NOT EXISTS "device_auth_requests" (
    "id" TEXT NOT NULL,
    "device_code_hash" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "architecture" TEXT NOT NULL,
    "agent_version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approved_by_user_id" TEXT,
    "org_id" TEXT,
    "developer_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "approved_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_auth_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "device_auth_requests_device_code_hash_key" ON "device_auth_requests"("device_code_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "device_auth_requests_user_code_key" ON "device_auth_requests"("user_code");
CREATE INDEX IF NOT EXISTS "device_auth_requests_expires_at_idx" ON "device_auth_requests"("expires_at");

ALTER TABLE "device_auth_requests" DROP CONSTRAINT IF EXISTS "device_auth_requests_org_id_fkey";
ALTER TABLE "device_auth_requests" ADD CONSTRAINT "device_auth_requests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "device_auth_requests" DROP CONSTRAINT IF EXISTS "device_auth_requests_developer_id_fkey";
ALTER TABLE "device_auth_requests" ADD CONSTRAINT "device_auth_requests_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
