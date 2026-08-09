import { BottomNav } from "@/components/BottomNav/BottomNav";

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="pb-20">{children}</div>
      <BottomNav />
    </>
  );
}
