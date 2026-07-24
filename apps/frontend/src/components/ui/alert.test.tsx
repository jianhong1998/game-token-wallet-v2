import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Alert } from "./alert";

describe("Alert", () => {
  it("renders success content with the cyan success color", () => {
    render(<Alert variant="success">registry initialized, 0 active games</Alert>);
    const alert = screen.getByRole("status");
    expect(alert).toHaveTextContent("registry initialized, 0 active games");
    expect(alert).toHaveClass("text-cyan-accent");
  });

  it("renders error content with the danger color", () => {
    render(<Alert variant="error">Unknown error</Alert>);
    const alert = screen.getByRole("status");
    expect(alert).toHaveTextContent("Unknown error");
    expect(alert).toHaveClass("text-danger");
  });

  it("forwards data-testid", () => {
    render(
      <Alert variant="success" data-testid="registry-status">
        ok
      </Alert>,
    );
    expect(screen.getByTestId("registry-status")).toBeInTheDocument();
  });
});
