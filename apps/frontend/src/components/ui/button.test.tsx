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

  it("hides content via 'opacity-0' rather than 'invisible'/'hidden', and never changes the button's own sizing classes, while isLoading", () => {
    const { rerender } = render(<Button>Initialize registry</Button>);

    const idleButton = screen.getByRole("button", { name: "Initialize registry" });
    const idleClassName = idleButton.className;
    const idleContent = screen.getByText("Initialize registry");
    expect(idleContent).not.toHaveClass("opacity-0");
    expect(idleContent).not.toHaveClass("invisible");
    expect(idleContent).not.toHaveClass("hidden");
    expect(idleContent).not.toHaveClass("sr-only");

    rerender(<Button isLoading>Initialize registry</Button>);

    // The button's own className (padding/sizing from buttonVariants) must be
    // identical whether idle or loading — isLoading only toggles `disabled`
    // and `aria-busy`, never the button's own box-sizing classes.
    const loadingButton = screen.getByRole("button", { name: "Initialize registry" });
    expect(loadingButton.className).toBe(idleClassName);

    // Loading-state children must be hidden via `opacity-0` (stays in layout
    // flow, preserving width, AND stays in the accessibility tree so the
    // button retains its accessible name). Must never use `invisible`
    // (visibility: hidden) or `hidden` (display: none) — both are excluded
    // from accessible-name computation, nor `sr-only` — which would make the
    // text visually invisible but keep it screen-reader-only in a way that
    // isn't intended here.
    const loadingContent = screen.getByText("Initialize registry");
    expect(loadingContent).toHaveClass("opacity-0");
    expect(loadingContent).not.toHaveClass("invisible");
    expect(loadingContent).not.toHaveClass("hidden");
    expect(loadingContent).not.toHaveClass("sr-only");
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
