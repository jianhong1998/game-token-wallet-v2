import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("renders its children", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("applies the gradient background and mobile-first shell classes", () => {
    const { container } = render(<AppShell>child</AppShell>);
    expect(container.querySelector(".bg-app-shell")).not.toBeNull();
    expect(container.querySelector(".app-shell")).not.toBeNull();
  });
});
