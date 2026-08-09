import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockUsePathname } = vi.hoisted(() => ({ mockUsePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: mockUsePathname }));

import AppGroupLayout from "./layout";

describe("AppGroupLayout", () => {
  it("renders children and the bottom nav", () => {
    mockUsePathname.mockReturnValue("/");
    render(
      <AppGroupLayout>
        <p>page content</p>
      </AppGroupLayout>,
    );
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-nav-home")).toBeInTheDocument();
  });
});
