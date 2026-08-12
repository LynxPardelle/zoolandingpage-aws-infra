# Mantenimiento pendiente al 2026-08-12

## Rama Phase 8 preservada

- La rama local original `codex/phase8-service-routing` se conserva sin rebase ni cambios en el worktree `Z:\GitHub\zoolandingpage-aws-infra-phase8-service-routing`.
- Su HEAD es `03e859ec25c1f175e61edc76b928068ea6556105`, con merge-base `dc2d311442c61b3fadda2efa85725d545bf624ff` frente a `origin/dev`.
- Al revisarla estaba un commit adelante y dos commits atrás de `origin/dev`. No existe una rama remota del mismo nombre; la rama local tiene `origin/dev` como upstream.
- El commit exclusivo pasó sus 23 pruebas de frontend y `cdk synth` en aislamiento.

## Integración segura

- El enrutamiento útil se trasladó sobre la punta actual de `origin/dev` a `codex/phase8-service-routing-maintenance-20260812`.
- Se conservaron las correcciones posteriores de QA-014 presentes en `dev`.
- No se trasladó el cambio de `Referrer-Policy` de `strict-origin-when-cross-origin` a `strict-origin`: estaba mezclado en el commit original, no pertenece al enrutamiento de servicios y requiere una revisión independiente de compatibilidad.
- La búsqueda por contenido e historial confirmó que el commit original es la única implementación de estas rutas y que ningún otro worktree o ref contiene ese commit.

## Requisito antes de desplegar

CloudFormation debe poder resolver estos parámetros SSM en cada ambiente antes de crear o actualizar la distribución:

- `/zoolanding/test/services/{data-spaces|commerce|integrations}/api-id`
- `/zoolanding/production/services/{data-spaces|commerce|integrations}/api-id`

Cada valor debe ser únicamente el API ID de API Gateway correspondiente. La distribución construye el dominio regional, usa el stage `/test` o `/production`, deshabilita caché y reenvía los métodos/autorización mediante la política existente. No sustituir las 14 rutas exactas por comodines amplios como `features/*`, ni agregar `webhooks/stripe/connect` a este cambio.

El synth con releases ficticios produjo 40 cache behaviors y 9 origins por distribución. Ambos están debajo de las cuotas predeterminadas vigentes documentadas por AWS (75 cache behaviors y 100 origins por distribución): <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html>.

Después de promover la rama nueva mediante el flujo `dev -> test -> main`, verificar que las seis entradas SSM existan y ejecutar una prueba funcional autenticada de lectura y escritura para cada servicio. La rama divergente original puede retirarse únicamente en una ventana de mantenimiento posterior y explícita.

## Dependencia de tooling pendiente

- `npm audit --audit-level=moderate`, usando el almacén de certificados del sistema, reporta una vulnerabilidad alta de denegación de servicio en `brace-expansion@5.0.6`, empaquetada dentro de `aws-cdk-lib@2.261.0`.
- `npm audit fix --dry-run` confirma que la dependencia empaquetada no se puede corregir automáticamente y no modificó `package.json` ni `package-lock.json`.
- No se hizo una actualización amplia de CDK dentro de este traslado funcional. Revisar una versión posterior en una rama dedicada y repetir pruebas y synth antes de cambiar los pins de CDK.
