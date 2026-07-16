# PDA System

PDA System es una aplicación web móvil orientada a operaciones de almacén, inventario y logística para dispositivos PDA. Está diseñada para facilitar tareas como recepción de mercancía, inventario, escaneo, ajustes, transferencias, merma, solicitudes y consultas operativas desde una interfaz rápida y pensada para uso táctil.

## Descripción general

El proyecto combina un frontend en React + TypeScript con un backend en Node.js + Express que expone APIs para consultar y, en algunos casos, registrar operaciones sobre una base de datos MariaDB. La interfaz está optimizada para pantallas pequeñas, con navegación tipo PDA y soporte para modo oscuro.

## Funcionalidades principales

- Inicio de sesión y autenticación
- Dashboard con métricas y módulos rápidos
- Escaneo de códigos de barras
- Gestión de órdenes de entrada y salida
- Recepción de material y seguimiento de estados
- Control de inventario y stock crítico
- Ajustes, conteos cíclicos y transferencias
- Registro de merma y solicitudes
- Historial y reportes operativos
- Configuración del backend desde la interfaz (con contraseña protegida)
- Soporte para múltiples idiomas y tema oscuro

## Tecnologías

### Frontend
- React 18
- TypeScript
- Vite
- Tailwind CSS
- Framer Motion
- Zustand
- React Router
- Lucide React

### Backend
- Node.js
- Express
- MariaDB via mysql2
- JWT / bcryptjs
- dotenv
- CORS

## Estructura del proyecto

```text
PDA_System/
├─ src/                  # Frontend React + TypeScript
│  ├─ Components/        # Layout, shell de navegación, componentes reutilizables
│  ├─ Pages/             # Módulos principales de la app
│  ├─ store/             # Zustand stores (auth, inventory)
│  ├─ utils/             # Traducciones y utilidades
│  └─ assets/            # Recursos estáticos e imágenes
├─ server/               # Backend Express + API
│  ├─ index.js           # Servidor principal
│  ├─ db.js              # Conexión a MariaDB
│  ├─ query_tables.js    # Utilidades de consulta
│  └─ .env               # Variables de entorno locales
├─ package.json          # Scripts del frontend
├─ server/package.json   # Scripts del backend
└─ README.md             # Documentación principal
```

## Requisitos previos

- Node.js 18 o superior
- npm o pnpm
- Acceso a una instancia de MariaDB con las tablas y columnas esperadas por la API

## Instalación

### 1) Instalar dependencias del frontend

```bash
npm install
```

### 2) Instalar dependencias del backend

```bash
cd server
npm install
```

## Configuración de entorno

Crea un archivo de entorno para el backend en [server/.env](server/.env) con al menos lo siguiente:

```env
DB_HOST=tu_host_mariadb
DB_PORT=3306
DB_USER=tu_usuario
DB_PASSWORD=tu_password
DB_NAME=tu_base
HOST=0.0.0.0
PORT=3001
API_HOST=localhost
API_PORT=3001
API_BASE_URL=http://localhost:3001
CONFIG_PASSWORD=tu_password_admin
```

> El backend incluye rutas de configuración que pueden editarse desde la interfaz protegida por la contraseña definida en CONFIG_PASSWORD.

## Ejecución

### Frontend

```bash
npm run dev
```

La app quedará disponible en:

```text
http://localhost:5173
```

### Backend

```bash
cd server
npm start
```

La API quedará disponible en:

```text
http://localhost:3001
```

### Verificaciones rápidas

- Salud del backend:

```text
http://localhost:3001/api/health
```

- Listado de tablas:

```text
http://localhost:3001/api/db/tables
```

## Módulos incluidos

- Dashboard
- Inventario
- Scanner
- Órdenes de entrada/salida
- Transferencias
- Ajustes
- Conteo cíclico
- Merma
- Solicitudes
- Historial
- Reportes
- Configuración

## Notas importantes

- El backend está orientado a operar en modo de lectura para consultas de base de datos, con excepciones específicas para rutas de escritura que se habilitan según la lógica del sistema.
- La app puede exponerse en red local o externa ajustando HOST y PORT.
- La configuración de conexión de la API se puede administrar desde la pantalla de login mediante un modal protegido.

## Desarrollo

Para construir la versión de producción del frontend:

```bash
npm run build
```

## Roadmap

- Integración con ERP y flujos de negocio más completos
- Soporte para modo offline parcial
- Mejoras en reportes y exportación de datos
- Integración con lectores RFID o escáneres adicionales
- Monitoreo en tiempo real y alertas operativas

## Despliegue en producción

Para desplegar la solución en un entorno real:

1. Configura correctamente las variables de entorno del backend en [server/.env](server/.env).
2. Asegura que la instancia de MariaDB sea accesible desde el servidor donde correrá la API.
3. Ejecuta el frontend y el backend en servidores o contenedores apropiados.
4. Usa un proxy inverso o puerta de enlace si deseas exponer la API públicamente.

## Autor

Desarrollado por Alexander J. Costilla.

## Licencia

Copyright © 2026 Alexander J. Costilla.
Todos los derechos reservados.

