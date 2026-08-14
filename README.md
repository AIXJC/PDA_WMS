<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0F172A,20:2563EB,45:06B6D4,70:10B981,100:22C55E&height=230&section=header&text=PDA%20WMS&fontSize=65&fontColor=FFFFFF&animation=fadeIn&fontAlignY=38&desc=Warehouse%20Management%20%7C%20Inventory%20%7C%20Logistics%20%7C%20PDA&descAlignY=62&descSize=18" width="100%"/>

<br>

<img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=700&size=22&duration=2500&pause=800&color=06B6D4&center=true&vCenter=true&width=850&lines=%F0%9F%93%A6+Warehouse+Management+System;%F0%9F%93%B1+PDA+Optimized+Interface;%F0%9F%94%8D+Barcode+Scanning;%F0%9F%93%8A+Inventory+Control;%F0%9F%94%84+Logistics+Operations;%F0%9F%97%84%EF%B8%8F+MariaDB+%2B+REST+API" />

<br><br>

![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge\&logo=react\&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge\&logo=typescript\&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge\&logo=node.js\&logoColor=white)
![Express](https://img.shields.io/badge/Express-API-000000?style=for-the-badge\&logo=express\&logoColor=white)
![MariaDB](https://img.shields.io/badge/MariaDB-Database-003545?style=for-the-badge\&logo=mariadb\&logoColor=white)

<br>

![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge\&logo=vite\&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge\&logo=tailwindcss\&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand-F59E0B?style=for-the-badge)
![Docker](https://img.shields.io/badge/Ready_for_Deployment-22C55E?style=for-the-badge\&logo=docker\&logoColor=white)

</div>

---

<div align="center">

# 📦 Warehouse Management System

### **Operaciones de almacén desde una interfaz diseñada para PDA**

</div>

PDA_WMS es una aplicación web móvil orientada a **operaciones de almacén, inventario y logística**, diseñada especialmente para dispositivos PDA y pantallas táctiles.

El sistema centraliza operaciones como:

> 📦 Recepción → 🔍 Escaneo → 📊 Inventario → 🔄 Transferencias → 📋 Solicitudes → 📈 Reportes

La aplicación combina un **frontend React + TypeScript**, un **backend Node.js + Express** y una base de datos **MariaDB**, proporcionando una plataforma para consultar, controlar y registrar operaciones de almacén.

---

# 🚀 What is PDA_WMS?

PDA_WMS nace con un objetivo sencillo:

<div align="center">

### **Convertir las operaciones físicas del almacén en procesos digitales, rápidos y trazables.**

</div>

El sistema está pensado para utilizarse directamente desde dispositivos PDA, permitiendo que el personal pueda realizar operaciones desde el área de trabajo sin depender de una estación de escritorio tradicional.

### 🎯 Enfoque

---

# ✨ Main Features

<div align="center">

|    📱 PDA    |  📦 Inventory  |   🔍 Scanner   |
| :----------: | :------------: | :------------: |
|   Touch UI   |  Stock control |     Barcode    |
| Mobile First | Critical stock |   Fast input   |
|   Dark Mode  |    Locations   | Product lookup |

| 📋 Orders | 🔄 Logistics | 📊 Analytics |
| :-------: | :----------: | :----------: |
|  Inbound  |   Transfers  |    Reports   |
|  Outbound |  Adjustments |    History   |
|  Requests |     Waste    |    Metrics   |

</div>

---

# 📱 PDA EXPERIENCE

La interfaz fue diseñada pensando en **dispositivos PDA y operación táctil**.

### Características

* 👆 Interfaz touch-friendly
* 📱 Diseño responsive
* ⚡ Acciones rápidas
* 🔍 Acceso directo al scanner
* 🌙 Modo oscuro
* 🌐 Soporte multiidioma
* 🧭 Navegación simplificada
* 📊 Información operacional de fácil lectura

### Objetivo

> **Menos navegación. Más operación.**

---

# BARCODE SCANNER

Uno de los componentes principales del sistema es el flujo de escaneo.

```text
             📱 PDA
               │
               ▼
          🔍 SCANNER
               │
               ▼
         🏷️ BARCODE
               │
               ▼
       ┌───────────────┐
       │  API REQUEST  │
       └───────┬───────┘
               │
               ▼
          🗄️ DATABASE
               │
               ▼
       📦 PRODUCT DATA
               │
               ▼
        📊 PDA DISPLAY
```

Permite utilizar el código de barras como punto de entrada para distintas operaciones de almacén.

---

#  INVENTORY MANAGEMENT

El módulo de inventario permite consultar y controlar información relacionada con:

* 📦 Existencias
* 📍 Ubicaciones
* 🏷️ Productos
* ⚠️ Stock crítico
* 🔄 Movimientos
* 📊 Consultas operativas
* 🔎 Búsquedas
* 🗂️ Historial

### Stock Flow

```text
        📦 PRODUCT
             │
             ▼
        📍 LOCATION
             │
             ▼
      📊 STOCK LEVEL
             │
       ┌─────┴─────┐
       ▼           ▼
   🟢 NORMAL    🔴 CRITICAL
       │           │
       ▼           ▼
   AVAILABLE     ⚠️ ALERT
```

---

#  INBOUND OPERATIONS

## Receiving & Incoming Orders

Gestión de órdenes y recepción de mercancía.

### Flujo

```text
 ORDER
   │
   ▼
 INBOUND
   │
   ▼
 RECEIVING
   │
   ▼
 SCANNING
   │
   ▼
 STORAGE
   │
   ▼
 INVENTORY UPDATED
```

El backend soporta filtros por estado y paginación para las consultas de entradas.

---

# 📤 OUTBOUND OPERATIONS

Gestión de solicitudes y operaciones de salida.

```text
📋 REQUEST
    │
    ▼
🟡 PENDING
    │
    ▼
📦 PREPARATION
    │
    ▼
🔍 VALIDATION
    │
    ▼
📤 OUTBOUND
    │
    ▼
🟢 COMPLETED
```

El historial permite visualizar las solicitudes consolidadas o filtrar operaciones según su estado.

---

# 🔄 TRANSFERS

Gestión de movimientos internos entre ubicaciones.

```text
      📍 LOCATION A
             │
             │
             ▼
       🔄 TRANSFER
             │
             ▼
      📍 LOCATION B
```

Orientado a mantener la trazabilidad de los movimientos internos de inventario.

---

# 🛠️ INVENTORY OPERATIONS

El sistema incluye diferentes operaciones para mantener actualizado el inventario:

| Operation          | Description                  |
| ------------------ | ---------------------------- |
| 🔄 **Transfers**   | Movimiento entre ubicaciones |
| ⚙️ **Adjustments** | Ajustes de inventario        |
| 🔢 **Cycle Count** | Conteos cíclicos             |
| 🗑️ **Waste**      | Registro de merma            |
| 📍 **Locations**   | Consulta de ubicaciones      |
| 🔎 **Lookup**      | Consulta de productos        |

---

# 📊 DASHBOARD

El dashboard funciona como punto central de operación.

### Información disponible

* 📦 Inventario
* 📥 Entradas
* 📤 Salidas
* 🔄 Transferencias
* ⚠️ Stock crítico
* 📋 Solicitudes
* 📈 Indicadores
* 🔎 Accesos rápidos

```text
┌─────────────────────────────────────────────┐
│                 PDA WMS                     │
├─────────────┬─────────────┬─────────────────┤
│ 📦 STOCK    │ 📥 INBOUND  │ 📤 OUTBOUND     │
│     1280    │      24     │       18        │
├─────────────┼─────────────┼─────────────────┤
│ 🔄 TRANSFER │ ⚠️ CRITICAL │ 📋 REQUESTS     │
│      31     │      12     │       09        │
└─────────────┴─────────────┴─────────────────┘
```

---

# 🔐 AUTHENTICATION & SECURITY

El sistema incluye autenticación y mecanismos de protección para las funciones administrativas.

### 🔑 Authentication

* JWT
* bcryptjs
* Protected routes
* Environment variables
* Configuration password

### ⚙️ Backend Configuration

La configuración de conexión del backend puede administrarse desde la interfaz mediante un modal protegido.

> ⚠️ Las credenciales y secretos deben mantenerse exclusivamente en variables de entorno y nunca almacenarse en el repositorio.

---

# 🌐 SYSTEM ARCHITECTURE

<div align="center">

```text
                 📱 PDA / MOBILE
                       │
                       ▼
              ┌─────────────────┐
              │   React + Vite  │
              │   TypeScript    │
              └────────┬────────┘
                       │
                       │ REST API
                       ▼
              ┌─────────────────┐
              │ Node.js /       │
              │ Express         │
              └────────┬────────┘
                       │
                       │ mysql2
                       ▼
              ┌─────────────────┐
              │     MariaDB     │
              └────────┬────────┘
                       │
                       ▼
                📊 WMS DATA
```

</div>

---

# 🧩 TECHNOLOGY STACK

<div align="center">

## 🎨 Frontend

![React](https://img.shields.io/badge/React_18-61DAFB?style=for-the-badge\&logo=react\&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge\&logo=typescript\&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge\&logo=vite\&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge\&logo=tailwindcss\&logoColor=white)

![Framer Motion](https://img.shields.io/badge/Framer_Motion-EC4899?style=for-the-badge\&logo=framer\&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand-F59E0B?style=for-the-badge)
![React Router](https://img.shields.io/badge/React_Router-CA4245?style=for-the-badge\&logo=reactrouter\&logoColor=white)
![Lucide](https://img.shields.io/badge/Lucide-8B5CF6?style=for-the-badge)

<br>

## ⚙️ Backend

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge\&logo=node.js\&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge\&logo=express\&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-F59E0B?style=for-the-badge\&logo=jsonwebtokens\&logoColor=white)
![bcrypt](https://img.shields.io/badge/bcryptjs-22C55E?style=for-the-badge)

<br>

## 🗄️ Database

![MariaDB](https://img.shields.io/badge/MariaDB-003545?style=for-the-badge\&logo=mariadb\&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL2-4479A1?style=for-the-badge\&logo=mysql\&logoColor=white)

</div>

---

# 📂 PROJECT STRUCTURE

```text
PDA_WMS/
│
├── 📱 src/
│   ├── Components/
│   │   ├── Layout/
│   │   ├── Navigation/
│   │   └── Shared/
│   │
│   ├── Pages/
│   │   ├── Dashboard
│   │   ├── Inventory
│   │   ├── Scanner
│   │   ├── Orders
│   │   ├── Transfers
│   │   ├── Adjustments
│   │   ├── CycleCount
│   │   ├── Waste
│   │   ├── Requests
│   │   ├── History
│   │   ├── Reports
│   │   └── Configuration
│   │
│   ├── store/
│   │   ├── auth
│   │   └── inventory
│   │
│   ├── utils/
│   │   └── translations
│   │
│   └── assets/
│
├── ⚙️ server/
│   ├── index.js
│   ├── db.js
│   ├── query_tables.js
│   ├── package.json
│   └── .env
│
├── 📦 package.json
├── ⚡ vite.config.*
└── 📖 README.md
```

---

# 🆕 RECENT CHANGES

### `2026-08-04`

#### 📤 `Salidas.tsx`

Se refactorizó el renderizado del historial para:

* Consolidar las solicitudes en la vista **Todos**
* Mostrar únicamente la sección seleccionada en vistas filtradas
* Mejorar la legibilidad
* Mantener la paginación
* Preservar el comportamiento de **Load More**

#### 📥 `Orders.tsx`

`loadInboundOrders()` ahora envía:

```text
status
offset
```

al backend cuando están disponibles.

Esto permite mantener filtros consistentes para órdenes pendientes provenientes del dashboard.

#### ⚙️ `server/index.js`

La ruta:

```text
/api/requests/inbound
```

ahora soporta:

```text
?status=pending
?offset=...
```

Además:

* 🔎 Filtrado por estado
* 📄 Paginación
* 📍 Filtrado explícito de ubicación
* 🔄 Flujo incoming → storage
* 🧩 Mapeo del estado `pending` al ID interno correspondiente

#### 🔧 General

Correcciones menores relacionadas con:

* Paginación
* Consultas de inventario
* Widget **Ver ubicaciones**

---

# 🛠️ REQUIREMENTS

Antes de ejecutar el proyecto necesitas:

* **Node.js 18+**
* npm o pnpm
* MariaDB
* Acceso a la base de datos
* Tablas y columnas esperadas por la API

---

# ⚡ INSTALLATION

## 1️⃣ Frontend

```bash
npm install
```

## 2️⃣ Backend

```bash
cd server
npm install
```

---

# 🔐 ENVIRONMENT CONFIGURATION

Crea:

```text
server/.env
```

con las variables necesarias:

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

> 🔒 **Nunca subas credenciales reales al repositorio.**

Se recomienda utilizar un `.env.example` para documentar las variables necesarias.

---

# ▶️ RUNNING THE PROJECT

## 🎨 Frontend

Desde la raíz:

```bash
npm run dev
```

Disponible normalmente en:

```text
http://localhost:5173
```

---

## ⚙️ Backend

```bash
cd server
npm start
```

API:

```text
http://localhost:3001
```

---

# ❤️ HEALTH CHECK

Puedes comprobar rápidamente el estado del backend:

```text
GET /api/health
```

Ejemplo:

```text
http://localhost:3001/api/health
```

---

# 🗄️ DATABASE CHECK

Para consultar las tablas disponibles:

```text
GET /api/db/tables
```

Ejemplo:

```text
http://localhost:3001/api/db/tables
```

---

# 🧪 DEVELOPMENT

Para generar la versión de producción:

```bash
npm run build
```

El frontend generado estará listo para ser servido mediante un servidor web o infraestructura de producción.

---

# 🚀 DEPLOYMENT

Para desplegar PDA_WMS en un entorno real:

### 01 — Environment

Configurar correctamente:

```text
server/.env
```

### 02 — Database

Garantizar conectividad entre la API y MariaDB.

### 03 — Backend

Ejecutar el servidor Node.js/Express.

### 04 — Frontend

Construir la aplicación:

```bash
npm run build
```

### 05 — Reverse Proxy

Para escenarios públicos o empresariales se recomienda utilizar un reverse proxy / gateway.

```text
                  🌐 INTERNET / LAN
                         │
                         ▼
                  🔐 REVERSE PROXY
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
         🎨 FRONTEND             ⚙️ API
                                    │
                                    ▼
                               🗄️ MariaDB
```

---

# 🗺️ ROADMAP

<div align="center">

| Status | Feature              |
| :----: | -------------------- |
|   🟢   | Core WMS Operations  |
|   🟢   | Inventory Management |
|   🟢   | PDA Interface        |
|   🟢   | Barcode Scanning     |
|   🟢   | Inbound / Outbound   |
|   🟢   | Transfers            |
|   🟢   | Adjustments          |
|   🟢   | Cycle Count          |
|   🟢   | Waste                |
|   🟢   | Requests             |
|   🟢   | History              |
|   🟡   | Advanced Reports     |
|   🟡   | Data Export          |
|   🔵   | Partial Offline Mode |
|   🔵   | RFID Integration     |
|   🔵   | Real-Time Monitoring |
|   🔵   | Advanced Alerts      |
|   🔵   | ERP Integration      |

</div>

---

# 🔮 FUTURE

La evolución del proyecto está orientada hacia un ecosistema WMS más completo:

```text
                         📦 PDA_WMS
                             │
             ┌───────────────┼───────────────┐
             ▼               ▼               ▼
          📱 PDA           📊 BI           🤖 IoT
             │               │               │
             ▼               ▼               ▼
        📦 INVENTORY      📈 ANALYTICS     📡 SENSORS
             │               │               │
             └───────────────┼───────────────┘
                             ▼
                       🔗 ERP INTEGRATION
                             │
                             ▼
                       🏭 BUSINESS SYSTEM
```

### Próximas líneas de desarrollo

* 🔗 Integración con ERP
* 📡 IoT
* 🏷️ RFID
* 📶 Offline-first
* 📊 Business Intelligence
* 🔔 Alertas en tiempo real
* 📈 Reportes avanzados
* 🤖 Automatización logística

---

# 👤 AUTHOR

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=rounded&color=0:2563EB,25:06B6D4,50:10B981,75:F59E0B,100:EC4899&height=120&section=header&text=Alexander%20J.%20Costilla&fontSize=34&fontColor=FFFFFF&animation=fadeIn" width="85%"/>

### **Alexander J. Costilla**

**Information Technology • Software Development • Industrial Systems**

<br>

`React` • `TypeScript` • `Node.js` • `MariaDB` • `WMS` • `Automation`

</div>

---

<div align="center">

### 📦 WAREHOUSE

### 📱 PDA

### 🔍 SCANNING

### 📊 INVENTORY

### ⚙️ LOGISTICS

<br>

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:22C55E,25:06B6D4,50:2563EB,75:8B5CF6,100:EC4899&height=120&section=footer" width="100%"/>

</div>


## Licencia

Copyright © 2026 Alexander J. Costilla.
Todos los derechos reservados.

