import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockInitializeRegistry } = vi.hoisted(() => ({
  mockInitializeRegistry: vi.fn(),
}));
vi.mock("@/server/actions/registry", () => ({
  initializeRegistry: mockInitializeRegistry,
}));

import AdminRegistryPage from "./page";

describe("AdminRegistryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the success alert with the exact registry status text", async () => {
    mockInitializeRegistry.mockResolvedValue({ activeGameCount: 0 });
    const user = userEvent.setup();
    render(<AdminRegistryPage />);

    await user.click(screen.getByRole("button", { name: "Initialize registry" }));

    const status = await screen.findByTestId("registry-status");
    expect(status).toHaveTextContent("registry initialized, 0 active games");
  });

  it("shows the error alert when the action rejects", async () => {
    mockInitializeRegistry.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<AdminRegistryPage />);

    await user.click(screen.getByRole("button", { name: "Initialize registry" }));

    const error = await screen.findByTestId("registry-error");
    expect(error).toHaveTextContent("boom");
  });
});
