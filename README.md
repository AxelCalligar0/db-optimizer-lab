# 🧪 DB Optimizer Lab

Laboratorio local para pruebas de optimización SQL, planes de ejecución e integración con agentes y MCP (Model Context Protocol).

---

## 📁 Estructura del Proyecto

```text
db-optimizer-lab/
├── .agents/
│   └── mcp_config.json      # Configuración MCP de workspace para Antigravity
├── antigravity.config.json  # Configuración MCP en raíz de proyecto
├── ecommerce.db             # Base de datos SQLite (~400.000 registros, ~20 MB)
├── package.json             # Scripts y dependencias del proyecto
├── queries_lentas.sql       # Banco de pruebas con 3 consultas sin índices
├── src/
│   ├── seed.js              # Generador de datos (customers, orders, order_items)
│   ├── profile.js           # Profiler de tiempos reales y EXPLAIN QUERY PLAN
│   └── mcp-server.js        # Servidor MCP stdio para agentes
└── README.md
```

---

## 📊 Datos Iniciales Generados

| Tabla | Registros | Estado de Índices |
| :--- | :--- | :--- |
| **`customers`** | 30.000 | Solo Primary Key (`id`) |
| **`orders`** | 120.000 | Solo Primary Key (`id`), sin índice en `customer_id` ni `order_date` |
| **`order_items`** | 250.000 | Solo Primary Key (`id`), sin índice en `order_id` ni `product_name` |
| **Total** | **400.000** | Escaneos secuenciales forzados (`SCAN TABLE`) |

---

## 🚀 Comandos Rápidos

```bash
# 1. Regenerar o resetear la base de datos de pruebas (400.000 registros)
npm run seed

# 2. Ejecutar el banco de pruebas de profiling
npm run profile

# 3. Iniciar el servidor MCP manualmente (por stdio)
npm run mcp
```

---

## 🛠️ Herramientas MCP Disponibles para Agentes

El servidor MCP expone las siguientes herramientas:

1. **`execute_query`**: Ejecuta consultas `SELECT`, midiendo el tiempo exacto de CPU en milisegundos y número de filas afectadas.
2. **`explain_query_plan`**: Ejecuta `EXPLAIN QUERY PLAN` y diagnostica si hay `SCAN TABLE` (secuenciales) vs `SEARCH TABLE USING INDEX`.
3. **`execute_ddl`**: Permite al agente crear índices (`CREATE INDEX ...`), borrarlos (`DROP INDEX ...`) o ejecutar `ANALYZE`.
4. **`get_schema`**: Inspecciona tablas, columnas, conteos de filas e índices actuales.

---

## 📋 Banco de Pruebas (`queries_lentas.sql`)

1. **Query 1: Filtro por fecha y estado (`orders`)**
   - *Problema:* Escaneo secuencial de 120.000 filas en `orders` (`SCAN orders`).
   - *Hipótesis de optimización:* `CREATE INDEX idx_orders_date_status ON orders(order_date, status);`
2. **Query 2: Búsqueda por texto y agregación (`order_items`)**
   - *Problema:* Escaneo secuencial de 250.000 filas en `order_items` (`SCAN order_items`).
   - *Hipótesis de optimización:* `CREATE INDEX idx_order_items_product ON order_items(product_name);` o índice cubriente con `category`.
3. **Query 3: Multi-Join complejo (`customers` + `orders` + `order_items`)**
   - *Problema:* Join masivo de 3 tablas sin índices en Foreign Keys (`customer_id`, `order_id`). Tiempo perceptible inicial: **~1.000+ ms**.
   - *Hipótesis de optimización:* Índices sobre `orders(customer_id)`, `order_items(order_id)` y `orders(status, order_date)`.
