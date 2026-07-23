export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-app-shell min-h-screen">
      <div className="app-shell min-h-screen px-6">{children}</div>
    </div>
  );
}
