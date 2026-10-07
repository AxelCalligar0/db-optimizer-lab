-- ==============================================================================
-- queries_lentas.sql: BANCO DE PRUEBAS DE OPTIMIZACIÓN SQL
-- Base de datos: ecommerce.db (~400.000 registros)
-- Tablas involucradas: customers (30.000), orders (120.000), order_items (250.000)
-- ==============================================================================
--
-- GUÍA DE LECTURA DE PLANES DE EJECUCIÓN (EXPLAIN QUERY PLAN):
-- 1. "SCAN <table>":
--    Indica que el motor lee fila por fila desde el disco o memoria.
--    Costo: O(N). Es el principal síntoma de lentitud en tablas grandes.
--
-- 2. "SEARCH <table> USING INDEX <nombre_indice>":
--    Indica que el motor navega un árbol binario/B-Tree balanceado.
--    Costo: O(log N). Es el comportamiento óptimo deseado.
--
-- 3. "USE TEMP B-TREE FOR GROUP BY / ORDER BY":
--    Indica que SQLite tuvo que crear una estructura temporal en memoria
--    para ordenar o agrupar porque los datos leídos no venían preordenados.
-- ==============================================================================


-- ------------------------------------------------------------------------------
-- QUERY 1: Filtro por rango de fechas y estado
-- Patrón analítico típico: Reportes mensuales de facturación por estado.
-- ------------------------------------------------------------------------------
-- ¿POR QUÉ ES LENTA ACTUALMENTE?
-- La tabla `orders` tiene 120.000 filas. Como no existe índice en `order_date` ni
-- en `status`, SQLite debe evaluar las 120.000 filas una a una (SCAN orders).
-- Luego, debe volcar los resultados en un árbol temporal para agrupar (TEMP B-TREE).
--
-- DIAGNÓSTICO DEL PLAN:
-- SCAN orders
-- USE TEMP B-TREE FOR GROUP BY
-- USE TEMP B-TREE FOR ORDER BY
--
-- CÓMO OPTIMIZARLA (ÍNDICE COMPUESTO):
-- CREATE INDEX idx_orders_date_status ON orders(order_date, status);
-- Con este índice, el motor salta directamente al rango de fechas solicitado
-- y descarta filas sin escanear toda la tabla.
-- ------------------------------------------------------------------------------
SELECT 
    status,
    strftime('%Y-%m', order_date) AS order_month,
    COUNT(*) AS total_orders,
    ROUND(SUM(total_amount), 2) AS total_revenue,
    ROUND(AVG(total_amount), 2) AS avg_ticket
FROM orders
WHERE order_date >= '2024-01-01 00:00:00' 
  AND order_date <= '2024-12-31 23:59:59'
  AND status IN ('completed', 'shipped')
GROUP BY status, order_month
ORDER BY total_revenue DESC;


-- ------------------------------------------------------------------------------
-- QUERY 2: Búsqueda textual y agregación con HAVING
-- Patrón analítico típico: Catálogo de productos más vendidos por coincidencia de texto.
-- ------------------------------------------------------------------------------
-- ¿POR QUÉ ES LENTA ACTUALMENTE?
-- La tabla `order_items` contiene 250.000 registros.
-- El predicado LIKE '%Keyboard%' o LIKE '%Headphones%' obliga a evaluar
-- cada fila individualmente. Al no haber índices en `product_name` ni `category`,
-- realiza un barrido total (SCAN order_items) y ordena con TEMP B-TREE.
--
-- DIAGNÓSTICO DEL PLAN:
-- SCAN order_items
-- USE TEMP B-TREE FOR GROUP BY
-- USE TEMP B-TREE FOR ORDER BY
--
-- CÓMO OPTIMIZARLA:
-- 1. Un índice B-Tree tradicional en `order_items(product_name)` ayuda cuando las
--    búsquedas son de prefijo ('Keyboard%'). Para búsquedas con comodín al inicio ('%Keyboard%'),
--    un índice cubriente `CREATE INDEX idx_oi_perf ON order_items(product_name, category, quantity, unit_price);`
--    evita acceder a la tabla base (index-only scan), o una tabla virtual FTS5.
-- ------------------------------------------------------------------------------
SELECT 
    category,
    product_name,
    COUNT(*) AS purchase_count,
    SUM(quantity) AS units_sold,
    ROUND(SUM(quantity * unit_price), 2) AS gross_revenue,
    ROUND(AVG(unit_price), 2) AS avg_price
FROM order_items
WHERE product_name LIKE '%Keyboard%' 
   OR product_name LIKE '%Headphones%'
GROUP BY category, product_name
HAVING units_sold > 500
ORDER BY gross_revenue DESC;


-- ------------------------------------------------------------------------------
-- QUERY 3: Multi-Join de 3 tablas sin índices en Foreign Keys
-- Patrón analítico típico: Perfilado de clientes de alto valor (VIP) y sus categorías preferidas.
-- ------------------------------------------------------------------------------
-- ¿POR QUÉ ES LENTA ACTUALMENTE? (Tiempo: > 1.000 ms)
-- Une customers (30.000) con orders (120.000) y order_items (250.000).
-- 1. `order_items` NO tiene índice en `order_id`.
-- 2. `orders` NO tiene índice en `customer_id`.
-- 3. Para cada orden, resolver las líneas requiere escaneos o mapeos forzados,
--    y acumular DISTINCT en memoria satura el pipeline.
--
-- DIAGNÓSTICO DEL PLAN:
-- SCAN oi (250.000 filas escaneadas secuencialmente)
-- SEARCH o USING INTEGER PRIMARY KEY (rowid=?)
-- SEARCH c USING INTEGER PRIMARY KEY (rowid=?)
-- USE TEMP B-TREE FOR GROUP BY
-- USE TEMP B-TREE FOR count(DISTINCT)
-- USE TEMP B-TREE FOR ORDER BY
--
-- CÓMO OPTIMIZARLA (ÍNDICES EN CLAVES FORÁNEAS + FILTROS):
-- 1. CREATE INDEX idx_orders_customer_date ON orders(customer_id, status, order_date);
-- 2. CREATE INDEX idx_order_items_order_id ON order_items(order_id);
-- Al indexar las claves foráneas, el tiempo cae drásticamente de ~1.000 ms a < 100 ms.
-- ------------------------------------------------------------------------------
SELECT 
    c.id AS customer_id,
    c.name AS customer_name,
    c.country,
    oi.category,
    COUNT(DISTINCT o.id) AS distinct_orders,
    SUM(oi.quantity) AS total_products_purchased,
    ROUND(SUM(oi.quantity * oi.unit_price), 2) AS total_spent
FROM customers c
JOIN orders o ON c.id = o.customer_id
JOIN order_items oi ON o.id = oi.order_id
WHERE o.status = 'completed'
  AND o.order_date >= '2024-01-01'
GROUP BY c.id, c.name, c.country, oi.category
HAVING total_spent > 1200
ORDER BY total_spent DESC
LIMIT 50;
