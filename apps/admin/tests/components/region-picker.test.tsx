// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import "../setup/component";
import { RegionPicker } from "@/components/auth/region-picker";

test("region picker stays hidden while the EU deployment is not live", () => {
  const { container } = render(<RegionPicker />);
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByText("Data region")).toBeNull();
});
