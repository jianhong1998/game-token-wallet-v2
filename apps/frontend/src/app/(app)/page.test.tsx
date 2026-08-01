import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockGetCurrentUsername } = vi.hoisted(() => ({ mockGetCurrentUsername: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({
  getCurrentUsername: mockGetCurrentUsername,
  logoutUser: vi.fn(),
}));

const { mockRedirect } = vi.hoisted(() => ({ mockRedirect: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  useRouter: () => ({ push: vi.fn() }),
}));

import HomePage from "./page";

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a welcome message with the current username", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    const jsx = await HomePage();
    render(jsx);
    expect(screen.getByTestId("home-welcome")).toHaveTextContent("Welcome, alice");
  });

  it("redirects to /login when there is no session", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await HomePage();
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });
});
