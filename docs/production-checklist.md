# Checklist de salida a producción

Pasos operativos que no son código y por lo tanto ningún test los
cubre. Repasar antes de cada despliegue a producción, y especialmente
antes del primero.

## Si vienes de un despliegue previo con nombres `wacrm`

El rename `wacrm` → `convix` (migración de esta edición H&M Business)
cambió tres cosas que **no se migran solas**:

1. **Volúmenes Docker**: `docker-compose.yml` ahora usa
   `convix-db` / `convix-minio-data` / `convix-storage` en vez de los
   nombres `wacrm-*`. Si el servidor ya tiene un despliegue corriendo
   con los volúmenes viejos, `docker compose up` con el compose nuevo
   crea volúmenes **nuevos y vacíos** — no reutiliza los datos. Antes
   de desplegar: `docker volume ls` en el servidor, y si existen los
   volúmenes `wacrm-*`, renómbralos (no hay `docker volume rename`;
   hay que crear el nuevo, copiar el contenido con un contenedor
   intermedio, o simplemente re-apuntar el compose a los nombres
   viejos) — la app funciona igual con cualquier nombre, elige el que
   evite perder datos.
2. **Cookie de sesión**: pasó de `wacrm-session` a `convix-session`.
   El primer deploy con el código nuevo invalida toda sesión activa —
   todos los usuarios tendrán que volver a iniciar sesión una vez.
   Es inofensivo, pero avisa al equipo/usuarios si aplica.
3. **Canales Postgres / prefijo Kafka**: `wacrm_changes` →
   `convix_changes`, tópicos `wacrm.*` → `convix.*`. Si hay algún
   consumidor externo (worker, integración) escuchando los canales
   viejos, actualízalo en el mismo despliegue.

## Cada despliegue

- [ ] CI verde en el commit a desplegar (lint, typecheck, test, build
      — corre también sobre `develop`, no solo `main`).
- [ ] `npm audit --omit=dev` sin vulnerabilidades nuevas.
- [ ] Backup de la base de datos **antes** de aplicar migraciones
      nuevas (`pg_dump`, o el snapshot del proveedor gestionado). No
      hay `down.sql` — una migración que rompe algo se revierte
      restaurando el backup, no con un comando.
- [ ] Si el despliegue escala a más de una réplica: el runner de
      migraciones (`scripts/migrate.mjs`) ya toma un
      `pg_advisory_lock` de sesión, así que correrlo en paralelo desde
      varios contenedores en un rolling deploy es seguro — el segundo
      simplemente espera a que el primero termine.
- [ ] El contenedor expone `HEALTHCHECK` sobre `GET /api/health`
      (verifica conexión a Postgres); apunta el orquestador
      (Swarm/K8s/Coolify/balanceador) a ese mismo endpoint.

## Rotación de `ENCRYPTION_KEY`

Cifra los tokens de acceso de WhatsApp (AES-256-GCM). Rotarla deja
ilegible todo lo cifrado con la clave anterior — no hay hoy un
mecanismo de re-cifrado automático. Procedimiento manual:

1. Generar la clave nueva:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. Con la app parada (o en ventana de mantenimiento): para cada fila
   cifrada con la clave vieja (hoy solo `whatsapp_config.access_token`),
   desencriptar con la clave vieja y re-encriptar con la nueva.
3. Desplegar con `ENCRYPTION_KEY` apuntando a la clave nueva.
4. Si el paso 2 se salta, cada integración de WhatsApp queda
   desconectada silenciosamente hasta que se reconecte a mano desde
   Configuración.

## Escaneo de secretos

No hay hoy un job de secret-scanning en CI (`.github/workflows/ci.yml`
solo cubre lint/typecheck/test/build). Dependabot ya cubre
dependencias. Antes de abrir el repo a más colaboradores, considera
añadir `gitleaks`/`trufflehog` como job de CI o activar GitHub
Advanced Security.
