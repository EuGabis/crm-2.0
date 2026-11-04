import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { criarFetchVigiado } from "./vigiar-falhas";

const fetchVigiado = criarFetchVigiado();

// Cliente para Server Components / Route Handlers. Sessão vem dos cookies.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { fetch: fetchVigiado },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll chamado de um Server Component — pode ignorar se houver
            // middleware renovando a sessão.
          }
        },
      },
    }
  );
}
