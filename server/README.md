# Backend MariaDB

Este backend conecta la app PDA con MariaDB. La app movil debe consumir esta API, no conectarse directamente a la base de datos.

## Configuracion

1. Copia `server/.env.example` como `server/.env`.
2. Llena `DB_PASSWORD` y `DB_NAME`.
3. Ajusta `PRODUCT_TABLE` y las columnas cuando confirmes los nombres reales de tus tablas.

Ejemplo:

```env
DB_HOST=192.168.1.152
DB_PORT=3306
DB_USER=Alex
DB_PASSWORD=tu_password
DB_NAME=tu_base
HOST=0.0.0.0
```

Si quieres exponer el servidor desde fuera de la red local con un dominio como `mes.softbank.mx`, necesitas:
- que `mes.softbank.mx` apunte a la IP pública de tu oficina
- que el router/firewall redirija el puerto `3001` al servidor donde corre la API
- que la conexión sea posible desde fuera de la red local

El servidor ya puede escucharen todas las interfaces usando `HOST=0.0.0.0`.

## Comandos

Instalar dependencias:

```bash
npm install
```

Levantar la API:

```bash
npm run api
```

Probar conexion:

```text
http://localhost:3001/api/health
```

Ver tablas:

```text
http://localhost:3001/api/db/tables
```

Ver columnas de una tabla:

```text
http://localhost:3001/api/db/tables/NOMBRE_TABLA/columns
```

Consultar inventario:

```text
http://localhost:3001/api/products
```

