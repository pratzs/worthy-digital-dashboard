import { redirect } from "next/navigation";

/* Social and Web lives in the Command Center now (one place, 27 Nov 2026). The old page is kept in SocialWebPage.js
   but not shown; old links and bookmarks land on the Command Center's Social and web tab. */
export default function Page() {
  redirect("/command#social");
}
