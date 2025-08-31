# Importador 7 Hábitos + Action para Notion

Este proyecto contiene scripts para crear y poblar automáticamente todas las bases de datos necesarias para un sistema de productividad basado en los **7 Hábitos** dentro de Notion. La carpeta `csv/` debe contener los archivos `db_*.csv` con los datos que desea importar (tareas, objetivos, hábitos, etc.).

## Requisitos

- Node.js 18 o superior.
- Una integración de Notion con permisos de lectura y escritura. Debe generar un **token secreto** y compartir la página donde se crearán las bases de datos con dicha integración.
- Un archivo `.env` en la raíz con las siguientes variables:
  
  ```env
  NOTION_TOKEN=su_token_de_notion
  NOTION_PARENT_PAGE_ID=id_de_la_pagina_en_notion
  DRY_RUN=        # opcional; si establece cualquier valor, no se crearán datos reales
  FORCE_CREATE_DB= # opcional; si vale "1", siempre creará nuevas bases aunque ya existan
  DB_PREFIX=7H_   # opcional; prefijo que se antepone al nombre de cada base
  ```

## Uso

### Instalación de dependencias

Instale las dependencias con:

```bash
npm install
```

### Ejecución de importación

Para ejecutar la importación real:

```bash
npm run import
```

Esto crea todas las bases definidas por los archivos `csv/db_*.csv` según la estructura indicada en `docs/mapping.yml` e inserta cada fila como una página dentro de la base. Al finalizar, genera un archivo `manifest.json` con los IDs de las bases de datos creadas.

### Ejecución en modo simulación (*Dry Run*)

Si desea ver qué haría el script sin modificar su espacio de trabajo, defina `DRY_RUN=1` en su `.env` y ejecute:

```bash
npm run dry
```

Se mostrarán en consola las operaciones (creación de bases y filas), pero no se contactará la API de Notion.

### Evitar duplicados (idempotencia)

Por defecto, el script comprueba si ya existe una base de datos en Notion con el nombre `7H_<nombre>` antes de crearla. Si existe, reutiliza la base encontrada y solo inserta las filas. Esto permite ejecutar la importación varias veces sin duplicar bases. Si desea forzar la creación de nuevas bases, establezca `FORCE_CREATE_DB=1` en su `.env`.

### Post-proceso: crear proyectos y relaciones

Después de la importación inicial, puede ejecutar el script de post-procesamiento para normalizar los proyectos y añadir relaciones entre bases:

```bash
npm run post
```

Este script (ubicado en `post_import.mjs`) creará una base de **Proyectos**, trasladará los proyectos encontrados en los CSV a esa base y vinculará cada tarea, objetivo, referencia o riesgo con su proyecto correspondiente mediante una propiedad de relación. Requiere que `manifest.json` exista.

### Verificación de importación

Para comprobar cuántas páginas se importaron en cada base, ejecute:

```bash
npm run verify
```

Esto genera un reporte `verification_report.json` con el conteo de páginas de cada base, útil para comparar con el número de filas en los CSV.

## Estructura del proyecto

- `import.mjs` – Script principal de importación.
- `post_import.mjs` – Script que crea la base de **Proyectos** y configura relaciones.
- `verify.mjs` – Script de verificación de conteos (no incluido en esta versión mejorada, se debe añadir si es necesario).
- `docs/mapping.yml` – Archivo YAML que define los tipos de propiedades de cada base.
- `csv/` – Carpeta donde debe colocar sus archivos CSV de origen. Deben llamarse `db_<nombre>.csv`.
- `.gitignore` – Archivos y carpetas a ignorar en Git.

## Preguntas frecuentes

- **¿Cómo obtengo el ID de la página de Notion?** Abra la página en Notion en el navegador y copie la parte final de la URL (un identificador largo con guiones). Ese es el `NOTION_PARENT_PAGE_ID`.
- **¿Qué ocurre si ejecuto el script varias veces?** Si no se establece `FORCE_CREATE_DB`, el script detectará bases existentes y no las recreará. Sin embargo, insertará todas las filas de los CSV de nuevo, por lo que puede crear duplicados de páginas. Para hacer actualizaciones incrementales se recomienda mejorar el script con lógica de *upsert*.
- **¿Puedo extender los campos de las bases?** Sí. Edite `docs/mapping.yml` y añada o modifique las propiedades de cada base. Los tipos soportados son: `select`, `multi_select`, `checkbox`, `url`, `rich_text`, `number`, `people`, `date` y `status`.

## Licencia

Este proyecto se proporciona sin garantía. Úselo a su propio riesgo y adáptelo a sus necesidades.
