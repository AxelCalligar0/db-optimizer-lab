/**
 * ==============================================================================
 * SCRIPT DE PROFILING: MEDICIÓN DE RENDIMIENTO Y ANÁLISIS DE PLANES DE EJECUCIÓN
 * Archivo: src/profile.js
 * ==============================================================================
 * 
 * PROPÓSITO:
 * Ejecuta de forma secuencial las 3 consultas de prueba sobre la base de datos
 * SQLite, extrayendo dos métricas fundamentales:
 * 
 * 1. PLAN DE EJECUCIÓN (EXPLAIN QUERY PLAN):
 *    Revela cómo SQLite resuelve internamente la consulta.
 *    - "SCAN <table>": Escaneo secuencial completo (recorre todas las filas de la tabla).
 *    - "SEARCH <table> USING INDEX ...": Búsqueda eficiente por árbol B de un índice.
 *    - "USE TEMP B-TREE FOR GROUP BY / ORDER BY": El motor tiene que almacenar datos
 *      en una estructura temporal en memoria para ordenar o agrupar porque los datos
 *      no están indexados en el orden requerido.
 * 
 * 2. TIEMPO DE EJECUCIÓN REAL (performance.now):
 *    Mide en milisegundos de alta precisión la latencia real desde el inicio
 *    de la ejecución hasta la entrega del conjunto de resultados.
 * ==============================================================================
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// Ruta de la base de datos
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'ecommerce.db');

// Validación de existencia previa
if (!fs.existsSync(DB_PATH)) {
  console.error(`Error: Base de datos no encontrada en ${DB_PATH}. Ejecuta 'npm run seed' primero.`);
  process.exit(1);
}

// Abrimos la base de datos SQLite en modo lectura/escritura síncrona
const db = new DatabaseSync(DB_PATH);

console.log('='.repeat(70));
console.log('🔍 BANCO DE PRUEBAS DE OPTIMIZACIÓN SQL (PROFILER)');
console.log(`Base de datos: ${DB_PATH}`);
console.log('='.repeat(70));

/**
 * DEFINICIÓN DE LAS CONSULTAS DE PRUEBA:
 * Cada una ataca un patrón común de ineficiencia en bases de datos relacionales:
 * - Query 1: Filtro por rango cronológico y valor discreto sin índice compuesto.
 * - Query 2: Búsqueda textual mediante comodines (%) y cálculo agregado.
 * - Query 3: Multi-Join de 3 tablas con agregaciones masivas y conteos distintos.
 */
const queries = [
  {
    name: 'Query 1: Filtro por rango de fecha y estado (Unindexed orders scan)',
    sql: `
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
    `
  },
  {
    name: 'Query 2: Búsqueda por texto y agregación (Unindexed LIKE scan)',
    sql: `
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
    `
  },
  {
    name: 'Query 3: Join complejo de 3 tablas sin índices en FK (Unindexed multi-join)',
    sql: `
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
    `
  }
];

// Iteramos y perfilamos cada consulta
queries.forEach((q, idx) => {
  console.log(`\n----------------------------------------------------------------------`);
  console.log(`[${idx + 1}/3] ${q.name}`);
  console.log(`----------------------------------------------------------------------`);

  // 1. Obtener y mostrar el plan de ejecución de SQLite
  try {
    const explainStmt = db.prepare(`EXPLAIN QUERY PLAN ${q.sql.trim()}`);
    const planRows = explainStmt.all();
    console.log('📋 PLAN DE EJECUCIÓN (EXPLAIN QUERY PLAN):');
    planRows.forEach(row => {
      console.log(`   - [id:${row.id}, parent:${row.parent}] ${row.detail}`);
    });
  } catch (err) {
    console.error('Error al obtener plan:', err.message);
  }

  // 2. Medir el tiempo real de ejecución con el cronómetro de alta resolución
  const start = performance.now();
  try {
    const queryStmt = db.prepare(q.sql.trim());
    const results = queryStmt.all();
    const durationMs = (performance.now() - start).toFixed(2);

    console.log(`\n⏱️  TIEMPO DE EJECUCIÓN: ${durationMs} ms`);
    console.log(`📊 FILAS DEVUELTAS:     ${results.length}`);
    if (results.length > 0) {
      console.log('📌 Muestra del primer resultado:', JSON.stringify(results[0]));
    }
  } catch (err) {
    console.error('Error al ejecutar consulta:', err.message);
  }
});

console.log('\n' + '='.repeat(70));
console.log('✅ Profiling completado con éxito.');
console.log('======================================================================\n');
