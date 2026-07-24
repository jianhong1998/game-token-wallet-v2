import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";

describe("Button", () => {
  it("defaults to the primary variant", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveClass("bg-gradient-primary");
  });

  it("applies the secondary variant class", () => {
    render(<Button variant="secondary">Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveClass("glass-input");
  });

  it("applies the destructive variant class", () => {
    render(<Button variant="destructive">Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveClass("bg-danger");
  });

  it("fires onClick when not loading", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows a spinner, disables the button, and blocks clicks while isLoading", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button onClick={onClick} isLoading>
        Go
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps the same rendered width while isLoading as while idle", () => {
    const { rerender, container } = render(<Button>Initialize registry</Button>);
    const idleWidth = container.querySelector("button")!.getBoundingClientRect().width;
    rerender(<Button isLoading>Initialize registry</Button>);
    const loadingWidth = container.querySelector("button")!.getBoundingClientRect().width;
    expect(loadingWidth).toBe(idleWidth);
  });

  it("with asChild, clones Button's props directly onto the consumer's element", () => {
    render(
      <Button asChild>
        <a href="/x" data-testid="link-target">
          Go
        </a>
      </Button>,
    );
    const link = screen.getByTestId("link-target");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/x");
    expect(link).toHaveClass("bg-gradient-primary");
  });
});
