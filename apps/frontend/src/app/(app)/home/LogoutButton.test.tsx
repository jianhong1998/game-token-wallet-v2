import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockLogoutUser } = vi.hoisted(() => ({ mockLogoutUser: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ logoutUser: mockLogoutUser }));

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import { LogoutButton } from "./LogoutButton";

describe("LogoutButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls logoutUser and redirects to /login on click", async () => {
    mockLogoutUser.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(mockLogoutUser).toHaveBeenCalled());
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login"));
  });
});
