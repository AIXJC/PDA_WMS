# Software Bank - Mobile Application

Aplicación móvil empresarial de alto rendimiento diseñada para dispositivos PDA industriales Android (Honeywell, Zebra, Chainway), optimizada para operaciones de almacén, logística e inventario en tiempo real.

## Características Implementadas

### 1. Autenticación Multi-modal
- **Login Tradicional**: Usuario y contraseña.
- **Acceso por PIN**: Teclado numérico optimizado para rapidez.
- **Acceso por QR**: Escaneo de gafete de empleado para inicio instantáneo.
- **Gestión de Roles**: Soporte para Administrador, Supervisor, Operador y Auditor.

### 2. Dashboard Operativo
- Interfaz de cuadrícula moderna con iconos industriales.
- Indicadores rápidos de órdenes pendientes y alertas críticas.
- Historial de actividad reciente integrado.

### 3. Módulo de Escaneo Avanzado (Core)
- **Simulación de Láser**: Interfaz visual de escaneo con feedback táctil y sonoro.
- **Modos de Operación**:
  - **Único**: Escaneo y apertura automática de ficha.
  - **Continuo**: Para procesamiento rápido de múltiples items.
  - **Masivo**: Conteo rápido de grandes volúmenes.
- **Control de Hardware**: Soporte para linterna (flash) y validación de SKU.

### 4. Gestión de Inventario
- Visualización en tiempo real con indicadores de stock bajo y crítico.
- Búsqueda avanzada por SKU, nombre o ubicación.
- Filtros rápidos de estado operativo.

### 5. Procesamiento de Órdenes (Entradas/Salidas)
- **Recepciones**: Validación contra orden de compra y registro de cantidades.
- **Picking**: Guía visual para surtido de pedidos con barra de progreso.
- **Validación**: Feedback visual instantáneo al completar items.

### 6. Control de Merma
- Registro de productos dañados con captura de evidencia fotográfica.
- Selección de motivos predefinidos y flujo de aprobación.

### 7. Configuración y Conectividad
- **Modo Offline**: Preparado para trabajar sin conexión con sincronización posterior.
- **Personalización**: Soporte para tema claro/oscuro e idioma (Español/Inglés).
- **Info de Dispositivo**: Detección de modelo de PDA y estado de batería.

## Especificaciones Técnicas

- **Framework**: React 18 + TypeScript.
- **Estilos**: Tailwind CSS (Diseño industrial de alto contraste).
- **Iconografía**: Lucide React.
- **Animaciones**: Framer Motion (Transiciones fluidas).
- **Estado**: Zustand (Persistencia de sesión e inventario).
- **Optimización**: Touch targets de 44px+ para uso con guantes.

## Reglas de Desarrollo Móvil

1. **Touch-First**: Todos los elementos interactivos deben ser fáciles de presionar.
2. **Feedback Inmediato**: Usar `src/utils/mobileFeatures.ts` para haptics y sonidos.
3. **Legibilidad**: Fuentes grandes y alto contraste para entornos de almacén.
4. **Eficiencia**: Minimizar los pasos para completar tareas críticas (escaneo, confirmación).

---
Desarrollado para **A|XJC** v1.0.0
