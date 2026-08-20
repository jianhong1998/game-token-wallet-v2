import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockGetCurrentUsername } = vi.hoisted(() => ({ mockGetCurrentUsername: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ getCurrentUsername: mockGetCurrentUsername }));

const { mockFetchGameDetail } = vi.hoisted(() => ({ mockFetchGameDetail: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ fetchGameDetail: mockFetchGameDetail }));

const { mockRedirect, mockNotFound, mockRefresh } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
  mockNotFound: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
  useRouter: () => ({ refresh: mockRefresh }),
}));

import GameDetailPage from "./page";

describe("GameDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when there is no session", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await GameDetailPage({ params: Promise.resolve({ address: "Game1" }) });
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("calls notFound when the game doesn't exist", async () => {
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockFetchGameDetail.mockResolvedValue(null);
    await GameDetailPage({ params: Promise.resolve({ address: "Game1" }) });
    expect(mockNotFound).toHaveBeenCalled();
  });

  it("shows the header, your balance, and the players roster", async () => {
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockFetchGameDetail.mockResolvedValue({
      address: "Game1",
      name: "Friday Poker",
      mode: 0,
      isAdmin: false,
      myBalance: 1.5,
      players: [
        { username: "alice", balance: 4, isAdmin: true },
        { username: "bob", balance: 1.5, isAdmin: false },
      ],
    });
    const jsx = await GameDetailPage({ params: Promise.resolve({ address: "Game1" }) });
    render(jsx);
    expect(screen.getByText("Friday Poker")).toBeInTheDocument();
    expect(screen.getByTestId("my-balance")).toHaveTextContent("1.5");
    expect(screen.getByTestId("players-list")).toHaveTextContent("alice");
    expect(screen.getByTestId("players-list")).toHaveTextContent("bob");
    expect(screen.queryByText("Admin")).toBeInTheDocument();
  });

  it("shows the admin badge and the Admin controls button when the viewer is the game's admin", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockFetchGameDetail.mockResolvedValue({
      address: "Game1",
      name: "Friday Poker",
      mode: 0,
      isAdmin: true,
      myBalance: 4,
      players: [{ username: "alice", balance: 4, isAdmin: true }],
    });
    const jsx = await GameDetailPage({ params: Promise.resolve({ address: "Game1" }) });
    render(jsx);
    expect(screen.getByTestId("game-admin-badge")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Admin controls" })).toBeInTheDocument();
  });

  it("does not show the Admin controls button for a non-admin viewer", async () => {
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockFetchGameDetail.mockResolvedValue({
      address: "Game1",
      name: "Friday Poker",
      mode: 0,
      isAdmin: false,
      myBalance: 1.5,
      players: [
        { username: "alice", balance: 4, isAdmin: true },
        { username: "bob", balance: 1.5, isAdmin: false },
      ],
    });
    const jsx = await GameDetailPage({ params: Promise.resolve({ address: "Game1" }) });
    render(jsx);
    expect(screen.queryByRole("button", { name: "Admin controls" })).not.toBeInTheDocument();
  });

  it("shows the Send tokens form for a General Mode game, for any member (not just the admin)", async () => {
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockFetchGameDetail.mockResolvedValue({
      address: "Game1",
      name: "Friday Poker",
      mode: 0,
      isAdmin: false,
      myBalance: 1.5,
      players: [
        { username: "alice", balance: 4, isAdmin: true },
        { username: "bob", balance: 1.5, isAdmin: false },
      ],
    });
    const jsx = await GameDetailPage({ params: Promise.resolve({ address: "Game1" }) });
    render(jsx);
    expect(screen.getByText("Send tokens")).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient")).toBeInTheDocument();
  });

  it("hides the Send tokens form for a non-General-Mode game", async () => {
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockFetchGameDetail.mockResolvedValue({
      address: "Game1",
      name: "Friday Hold'em",
      mode: 1,
      isAdmin: false,
      myBalance: 1.5,
      players: [{ username: "bob", balance: 1.5, isAdmin: false }],
    });
    const jsx = await GameDetailPage({ params: Promise.resolve({ address: "Game1" }) });
    render(jsx);
    expect(screen.queryByText("Send tokens")).not.toBeInTheDocument();
  });

  it("shows the Quit game button for a non-admin player", async () => {
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockFetchGameDetail.mockResolvedValue({
      address: "Game1",
      name: "Friday Poker",
      mode: 0,
      isAdmin: false,
      myBalance: 1.5,
      players: [
        { username: "alice", balance: 4, isAdmin: true },
        { username: "bob", balance: 1.5, isAdmin: false },
      ],
    });
    const jsx = await GameDetailPage({ params: Promise.resolve({ address: "Game1" }) });
    render(jsx);
    expect(screen.getByRole("button", { name: "Quit game" })).toBeInTheDocument();
  });

  it("does not show the Quit game button for the game's admin", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockFetchGameDetail.mockResolvedValue({
      address: "Game1",
      name: "Friday Poker",
      mode: 0,
      isAdmin: true,
      myBalance: 4,
      players: [{ username: "alice", balance: 4, isAdmin: true }],
    });
    const jsx = await GameDetailPage({ params: Promise.resolve({ address: "Game1" }) });
    render(jsx);
    expect(screen.queryByRole("button", { name: "Quit game" })).not.toBeInTheDocument();
  });
});
