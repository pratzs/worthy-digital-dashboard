import { redirect } from "next/navigation";

// Sales by Rep now sits on the Overview and Sales page; keep old links and bookmarks working.
export default function Page() {
  redirect("/");
}
