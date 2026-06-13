<!--
ModeloCFO — plantilla de Pull Request.
Recuerda: `main` está protegida. Se entra SOLO por PR en DRAFT. Nunca push directo a main.
Commits convencionales: feat:, fix:, chore:, docs:, test:.
-->

## Alcance

<!-- Qué hace este PR, en 2-4 líneas. Agente/rama si aplica (AGxx). -->



## Checklist

### Alcance y proceso
- [ ] PR abierto en **DRAFT** contra `main` (sin push directo a `main`).
- [ ] Commits convencionales (`feat:` / `fix:` / `chore:` / `docs:` / `test:`).
- [ ] El cambio se limita al alcance descrito; no toca áreas ajenas.
- [ ] No se añaden dependencias nuevas (o se justifica cada una abajo).

### Verificación (todo verde)
- [ ] `npm run build`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`

### Seguridad
- [ ] **Sin secretos** en el código ni en el historial (claves, tokens, JWT).
      `.env.local` no se commitea; `.env.example` actualizado si cambian variables.
- [ ] Ninguna ruta acepta `user_id` del cliente; la identidad sale de
      `supabase.auth.getUser()`.
- [ ] **RLS activo** en cualquier tabla nueva (multitenant por `user_id`).
- [ ] Si toca rutas/datos: considerado el aislamiento cross-tenant
      (`scripts/security-check.ts` si aplica).

### Documentación
- [ ] `docs/control/AGxx_RESUMEN.md` creado/actualizado (sigue
      `docs/control/PLANTILLA_RESUMEN.md`).
- [ ] README / docs actualizados si cambia el setup, comandos o variables.

## Dependencias nuevas

<!-- Lista cada dependencia añadida y por qué. "Ninguna" si no hay. -->
Ninguna.

## Pendientes que hereda el siguiente agente / Luis

<!-- Migraciones a aplicar, Edge Functions a desplegar, validaciones manuales, capturas, etc. -->


## Notas de prueba

<!-- Cómo verificar este PR a mano, si aplica. -->
