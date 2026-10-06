package cmd

import (
	"fmt"
	"os"
	"strings"

	"github.com/usejunction/agent/internal/config"
)

// CollectionNoticeVersion must match apps/admin/lib/legal/versions.ts.
const CollectionNoticeVersion = "2026-09-18"

func collectionNoticeText() string {
	return strings.TrimSpace(`What UseJunction collects from this device (notice ` + CollectionNoticeVersion + `)

Your organization is connecting this machine so the team can see AI coding tool
usage, estimated cost, plan utilization, and device health.

Collected: hostname/OS, installed tools and account emails, aggregated token/cost
usage, and heartbeat status.

Never collected: keystrokes, screenshots, clipboard, source code, file contents,
or full chat transcripts.

Review uploaded data in the product under My data. Continuing enrolls this device.`)
}

func envTruthy(name string) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(name)))
	return value == "1" || value == "true" || value == "yes"
}

func acceptCollectionNotice(opts enrollOptions) error {
	if existing, err := config.Load(); err == nil && existing.CollectionNoticeVersion == CollectionNoticeVersion {
		return nil
	}
	if opts.AcceptNotice || envTruthy("USEJUNCTION_ACCEPT_COLLECTION_NOTICE") {
		if !opts.Quiet && format != "json" {
			fmt.Println(collectionNoticeText())
			fmt.Println()
		}
		return nil
	}
	if !opts.Quiet && format != "json" {
		fmt.Println(collectionNoticeText())
		fmt.Println()
	}
	return fmt.Errorf("acknowledge the collection notice with --accept-collection-notice (or USEJUNCTION_ACCEPT_COLLECTION_NOTICE=1)")
}
