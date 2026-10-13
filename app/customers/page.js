import { redirect } from "next/navigation";

// Fast & Slow Movers and Customers are part of the Analytics page now; keep old links working.
export default function Page() {
  redirect("/products");
}
