package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/usejunction/agent/internal/client"
	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/ui"
)

// Sign-in from the terminal: no token to copy. The agent prints a link, the
// person signs in (or signs up) and approves this machine in the browser, and
// the agent receives its device credentials.

const productionControlPlaneURL = "https://usejunction.dev"

var (
	loginURL       string
	loginNoBrowser bool
	loginAccounts  string

	// Floor on the poll interval; tests lower it.
	deviceAuthMinInterval = 2 * time.Second
	// Consecutive network failures tolerated while waiting for approval.
	deviceAuthMaxPollErrors = 5
)

type loginOptions struct {
	URL       string
	NoBrowser bool
}

// resolveLoginURL picks the control plane to sign in to: the flag, then
// $USEJUNCTION_URL, then production (or the local admin for a test profile).
func resolveLoginURL(flagURL string) string {
	if u := strings.TrimSpace(flagURL); u != "" {
		return strings.TrimRight(u, "/")
	}
	if u := strings.TrimSpace(os.Getenv("USEJUNCTION_URL")); u != "" {
		return strings.TrimRight(u, "/")
	}
	if config.IsTestProfile() {
		return "http://localhost:3001"
	}
	return productionControlPlaneURL
}

// openBrowser asks the OS to open url. It reports failure rather than
// printing: the link is always shown, so a machine with no browser still works.
var openBrowser = func(url string) error {
	if envTruthy("USEJUNCTION_NO_BROWSER") {
		return errors.New("browser disabled")
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		// Over SSH or on a server there is no desktop to open a browser on.
		if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
			return errors.New("no display")
		}
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}

type deviceAuthPoller func(ctx context.Context) (*client.DeviceAuthPollResponse, error)

// waitForDeviceApproval polls until the request is approved, refused, expired,
// or the wait outlives the request. sleep returns early with ctx's error.
func waitForDeviceApproval(
	ctx context.Context,
	poll deviceAuthPoller,
	interval time.Duration,
	expiresIn time.Duration,
	sleep func(context.Context, time.Duration) error,
) (*client.EnrollResponse, error) {
	if interval < deviceAuthMinInterval {
		interval = deviceAuthMinInterval
	}
	if expiresIn <= 0 {
		expiresIn = 15 * time.Minute
	}
	deadline := time.Now().Add(expiresIn)
	failures := 0

	for {
		if err := sleep(ctx, interval); err != nil {
			return nil, err
		}
		resp, err := poll(ctx)
		if err != nil {
			if errors.Is(err, client.ErrDeviceAuthSlowDown) {
				interval *= 2
				continue
			}
			failures++
			if failures >= deviceAuthMaxPollErrors {
				return nil, fmt.Errorf("lost contact with UseJunction while waiting: %w", err)
			}
			continue
		}
		failures = 0

		switch resp.Status {
		case client.DeviceAuthApproved:
			if resp.DeviceToken == "" || resp.DeviceID == "" {
				return nil, errors.New("sign-in was approved but no device credentials were returned")
			}
			enrolled := resp.EnrollResponse
			return &enrolled, nil
		case client.DeviceAuthDenied:
			return nil, errors.New("this device was refused in the browser; nothing was connected")
		case client.DeviceAuthExpired:
			return nil, errors.New("the code expired before it was approved; run the command again for a new one")
		case client.DeviceAuthConsumed:
			return nil, errors.New("this sign-in was already completed; run the command again")
		case client.DeviceAuthFailed:
			if msg := strings.TrimSpace(resp.Error); msg != "" {
				return nil, errors.New(deviceAuthFailureHint(msg))
			}
			return nil, errors.New("the device could not be connected")
		}
		if time.Now().After(deadline) {
			return nil, errors.New("the code expired before it was approved; run the command again for a new one")
		}
	}
}

// deviceAuthFailureHint rewrites the control plane's terse refusals into what to do next.
func deviceAuthFailureHint(msg string) string {
	if strings.Contains(msg, "already has a device enrolled") {
		return "you already have a device connected in this workspace; remove it under My devices in the dashboard, then run the command again"
	}
	return msg
}

func sleepContext(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// doLogin runs the browser sign-in and saves the device credentials. It does
// not upload anything; callers decide what first-run work follows.
func doLogin(ctx context.Context, opts loginOptions) (*enrollResult, error) {
	url := resolveLoginURL(opts.URL)
	if err := warnEnrollmentTarget(url, enrollOptions{Quiet: format == "json"}); err != nil {
		return nil, err
	}

	osName, arch := platformInfo()
	started, err := client.StartDeviceAuth(ctx, url, client.DeviceAuthStartRequest{
		Hostname:     hostname(),
		OS:           osName,
		Architecture: arch,
		AgentVersion: config.Version,
	})
	if err != nil {
		if errors.Is(err, client.ErrDeviceAuthUnsupported) {
			return nil, fmt.Errorf("%w; sign in at %s, copy the install command with your token, and run that instead", err, url)
		}
		return nil, err
	}

	opened := false
	if !opts.NoBrowser {
		opened = openBrowser(started.VerificationURL) == nil
	}
	if format == "json" {
		printJSON(map[string]any{
			"verificationUrl": started.VerificationURL,
			"userCode":        started.UserCode,
			"expiresIn":       started.ExpiresIn,
		})
	} else {
		ui.SignInPrompt(started.VerificationURL, started.UserCode, opened)
	}

	step := ui.StepStart("Waiting for you to approve this device")
	resp, err := waitForDeviceApproval(
		ctx,
		func(ctx context.Context) (*client.DeviceAuthPollResponse, error) {
			return client.PollDeviceAuth(ctx, url, started.DeviceCode)
		},
		time.Duration(started.Interval)*time.Second,
		time.Duration(started.ExpiresIn)*time.Second,
		sleepContext,
	)
	if err != nil {
		step.Fail(err.Error())
		return nil, err
	}
	step.Done(deviceLabel(resp.DeviceID))

	return finishEnrollment(url, resp, enrollOptions{
		URL:           url,
		Setup:         false,
		Quiet:         true,
		NoReportPrint: true,
		// Approving in the browser is the acknowledgement; the page shows the notice.
		AcceptNotice: true,
	})
}

// alreadyConnected reports the saved enrollment, if this machine has one.
func alreadyConnected() *config.Config {
	cfg, err := config.Load()
	if err != nil || cfg == nil || cfg.DeviceToken == "" {
		return nil
	}
	return cfg
}

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Sign in from the terminal and connect this device",
	Long: `Connects this device without a token to copy:
  1. Read local usage and show the last 30 days, on this machine only
  2. Open the browser so you can sign in (or sign up) and approve this device
  3. Choose which signed-in accounts to collect from
  4. Upload initial usage

Nothing is uploaded until the device is approved. On a machine with no
browser, open the printed link on any other device.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		ui.SetNoColor(noColor || format == "json")
		if cfg := alreadyConnected(); cfg != nil {
			if format == "json" {
				printJSON(map[string]any{"ok": true, "alreadyConnected": true, "deviceId": cfg.DeviceID, "orgId": cfg.OrgID})
				return nil
			}
			fmt.Printf("This device is already connected (%s).\n", deviceLabel(cfg.DeviceID))
			fmt.Printf("Dashboard: %s\n", cfg.ControlPlaneURL)
			return nil
		}
		if err := runSignInOnboard(loginOptions{URL: loginURL, NoBrowser: loginNoBrowser}, loginAccounts); err != nil {
			return err
		}
		if format != "json" {
			url := resolveLoginURL(loginURL)
			ui.QuietLine("If background syncing is not running yet, start it with:")
			ui.QuietLine(fmt.Sprintf("curl -fsSL %s/install.sh | sh -s -- --resume --url %s", url, url))
		}
		return nil
	},
}

func init() {
	loginCmd.Flags().StringVar(&loginURL, "url", "", "Control plane URL (default: $USEJUNCTION_URL or https://usejunction.dev)")
	loginCmd.Flags().BoolVar(&loginNoBrowser, "no-browser", false, "Print the sign-in link without opening a browser")
	loginCmd.Flags().StringVar(&loginAccounts, "accounts", os.Getenv("USEJUNCTION_ACCOUNTS"), `Skip the account picker: "all", "none", or a comma-separated list of emails, providers, or provider:email`)
	rootCmd.AddCommand(loginCmd)
}
