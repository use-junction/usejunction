package cmd

import (
	"fmt"
	"os"
	"runtime"

	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/install"
)

func maybeRelocateDarwinDaemon() {
	if runtime.GOOS != "darwin" {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		fmt.Printf("[daemon] relocate skipped: %v\n", err)
		return
	}
	id := config.CurrentServiceIdentity()
	configDir := config.ConfigDir()
	if err := install.CleanupLegacyBundles(exe, id, configDir); err != nil {
		fmt.Printf("[daemon] legacy bundle cleanup warning: %v\n", err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Printf("[daemon] relocate skipped: %v\n", err)
		return
	}
	restarted, err := install.RelocateIfNeeded(install.RelocateInput{
		Executable: exe,
		UserHome:   home,
		ConfigDir:  configDir,
		Identity:   id,
		Restart: func(userHome, _ string) error {
			return restartDarwinLaunchAgent(userHome)
		},
	})
	if err != nil {
		fmt.Printf("[daemon] relocate warning: %v\n", err)
		return
	}
	if restarted {
		fmt.Println("[daemon] moved app bundle to ~/Applications; restarting from visible path")
		os.Exit(0)
	}
}
