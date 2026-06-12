import { redirect } from "next/navigation";

// La raíz lleva al chat; el middleware redirige a /login si no hay sesión.
export default function Home() {
  redirect("/chat");
}
