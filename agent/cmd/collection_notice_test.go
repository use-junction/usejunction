package cmd

import (
	"strings"
	"testing"

	"github.com/usejunction/agent/internal/config"
)

func TestCollectionNoticeTextIncludesVersion(t *testing.T) {
	text := collectionNoticeText()
	if !strings.Contains(text, CollectionNoticeVersion) {
		t.Fatalf("notice %q missing version %s", text, CollectionNoticeVersion)
	}
	if !strings.Contains(text, "Never collected") {
		t.Fatal("notice missing the never-collected boundary")
	}
}

func TestCollectionNoticeAcceptFlagAndEnv(t *testing.T) {
	format = "json"
	if err := acceptCollectionNotice(enrollOptions{AcceptNotice: true, Quiet: true}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("USEJUNCTION_ACCEPT_COLLECTION_NOTICE", "yes")
	if err := acceptCollectionNotice(enrollOptions{Quiet: true}); err != nil {
		t.Fatal(err)
	}
}

func TestCollectionNoticeRequiresAcknowledgement(t *testing.T) {
	format = "json"
	t.Setenv("USEJUNCTION_ACCEPT_COLLECTION_NOTICE", "")
	if existing, err := config.Load(); err == nil && existing.CollectionNoticeVersion == CollectionNoticeVersion {
		t.Skip("local config already accepted this notice")
	}
	err := acceptCollectionNotice(enrollOptions{Quiet: true})
	if err == nil || !strings.Contains(err.Error(), "--accept-collection-notice") {
		t.Fatalf("expected acknowledgement error, got %v", err)
	}
}
