import { Suspense } from "react";
import type { Metadata } from "next";
import { ConnectDeviceClient } from "./connect-device-client";

export const metadata: Metadata = {
  title: "Connect a device",
  robots: { index: false, follow: false },
};

export default function ConnectDevicePage() {
  return (
    <Suspense>
      <ConnectDeviceClient />
    </Suspense>
  );
}
