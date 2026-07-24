import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./input";

describe("Input", () => {
  it("renders as a text input and accepts typed input", async () => {
    const user = userEvent.setup();
    render(<Input placeholder="Username" />);
    const input = screen.getByPlaceholderText("Username");
    await user.type(input, "alice");
    expect(input).toHaveValue("alice");
  });

  it("applies the glass surface styling", () => {
    render(<Input placeholder="Username" />);
    expect(screen.getByPlaceholderText("Username")).toHaveClass("glass-input");
  });

  it("forwards a ref to the underlying input element", () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<Input ref={ref} placeholder="Username" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
