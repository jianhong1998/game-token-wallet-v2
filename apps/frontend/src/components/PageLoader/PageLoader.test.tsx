import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageLoader } from "./PageLoader";

describe("PageLoader", () => {
  it("renders an accessible loading status", () => {
    render(<PageLoader />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("renders the chip icon with the flip animation class", () => {
    render(<PageLoader />);
    const icon = screen.getByRole("status").querySelector("img");
    expect(icon).toHaveAttribute("src", "/chip-icon.svg");
    expect(icon).toHaveClass("animate-chip-flip");
  });
});
