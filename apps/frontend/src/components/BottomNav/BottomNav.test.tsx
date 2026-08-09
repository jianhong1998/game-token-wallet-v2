import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockUsePathname } = vi.hoisted(() => ({ mockUsePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: mockUsePathname }));

import { BottomNav } from "./BottomNav";

describe("BottomNav", () => {
  it("renders Home, Browse, and You tabs with the correct links", () => {
    mockUsePathname.mockReturnValue("/");
    render(<BottomNav />);
    expect(screen.getByTestId("bottom-nav-home")).toHaveAttribute("href", "/");
    expect(screen.getByTestId("bottom-nav-browse")).toHaveAttribute("href", "/games/all");
    expect(screen.getByTestId("bottom-nav-you")).toHaveAttribute("href", "/account");
  });

  it("marks the tab matching the current route as active", () => {
    mockUsePathname.mockReturnValue("/account");
    render(<BottomNav />);
    expect(screen.getByTestId("bottom-nav-you")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("bottom-nav-home")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("bottom-nav-browse")).not.toHaveAttribute("aria-current");
  });

  it("marks Home active on the root route, not just an exact string match on other tabs", () => {
    mockUsePathname.mockReturnValue("/");
    render(<BottomNav />);
    expect(screen.getByTestId("bottom-nav-home")).toHaveAttribute("aria-current", "page");
  });
});
