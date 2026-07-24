import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockLoginUser } = vi.hoisted(() => ({ mockLoginUser: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ loginUser: mockLoginUser }));

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import LoginPage from "./page";

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits and redirects to /home on success", async () => {
    mockLoginUser.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByPlaceholderText("Username"), "alice");
    await user.type(screen.getByPlaceholderText("Password"), "Abcdef12");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/home"));
    expect(mockLoginUser).toHaveBeenCalledWith({ username: "alice", password: "Abcdef12" });
  });

  it("shows the generic error alert when login fails", async () => {
    mockLoginUser.mockResolvedValue({ ok: false, error: "Invalid username or password" });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByPlaceholderText("Username"), "alice");
    await user.type(screen.getByPlaceholderText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByTestId("login-error")).toHaveTextContent("Invalid username or password");
  });
});
