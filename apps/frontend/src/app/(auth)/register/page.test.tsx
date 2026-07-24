import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockRegisterUser } = vi.hoisted(() => ({ mockRegisterUser: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ registerUser: mockRegisterUser }));

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import RegisterPage from "./page";

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a live hint for an invalid username without submitting", async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByPlaceholderText("Username"), "a!");
    expect(await screen.findByTestId("username-hint")).toBeInTheDocument();
    expect(mockRegisterUser).not.toHaveBeenCalled();
  });

  it("shows a live hint when confirm password doesn't match", async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByPlaceholderText("Password"), "Abcdef12");
    await user.type(screen.getByPlaceholderText("Confirm password"), "Abcdef13");
    expect(await screen.findByTestId("confirm-password-hint")).toBeInTheDocument();
  });

  it("submits and redirects to /home on success", async () => {
    mockRegisterUser.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByPlaceholderText("Username"), "alice");
    await user.type(screen.getByPlaceholderText("Password"), "Abcdef12");
    await user.type(screen.getByPlaceholderText("Confirm password"), "Abcdef12");
    await user.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/home"));
    expect(mockRegisterUser).toHaveBeenCalledWith({
      username: "alice",
      password: "Abcdef12",
      confirmPassword: "Abcdef12",
    });
  });

  it("shows the error alert when registration fails", async () => {
    mockRegisterUser.mockResolvedValue({ ok: false, error: "Username already taken" });
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByPlaceholderText("Username"), "alice");
    await user.type(screen.getByPlaceholderText("Password"), "Abcdef12");
    await user.type(screen.getByPlaceholderText("Confirm password"), "Abcdef12");
    await user.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByTestId("register-error")).toHaveTextContent("Username already taken");
  });
});
