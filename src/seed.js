/**
 * ==============================================================================
 * SCRIPT DE SEMILLA (SEED): GENERACIÓN DE DATOS DE PRUEBA PARA E-COMMERCE
 * Archivo: src/seed.js
 * ==============================================================================
 * 
 * PROPÓSITO:
 * Genera una base de datos SQLite con 400.000 registros repartidos en tres
 * tablas relacionadas (customers, orders, order_items).
 * 
 * DETALLE CLAVE DE DISEÑO:
 * No se crean índices secundarios intencionalmente (únicamente existen las
 * claves primarias autoincrementales). Esto asegura que cualquier filtro por fecha,
 * búsqueda de texto o JOIN requiera un "Full Table Scan" (SCAN TABLE), ideal
 * para medir tiempos reales y comparar optimizaciones posteriores.
 * ==============================================================================
 */

// Importamos el módulo nativo de SQLite disponible en Node.js 22.5+ / 24+
// Al ser nativo, no requiere compilar binarios C++ con node-gyp en Windows.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// Ruta donde se creará o reemplazará el archivo de base de datos
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'ecommerce.db');

// Si ya existe una base de datos previa, la eliminamos para garantizar un estado limpio y reproducible
if (fs.existsSync(DB_PATH)) {
  console.log(`Eliminando base de datos anterior en: ${DB_PATH}...`);
  fs.unlinkSync(DB_PATH);
}

// Inicializamos la conexión sincronizada a la base de datos
const db = new DatabaseSync(DB_PATH);

console.log(`Inicializando base de datos SQLite en: ${DB_PATH}`);

/**
 * OPTIMIZACIÓN DE ESCRITURA EN DISCO (PRAGMAS):
 * Durante la inserción masiva desactivamos la sincronización inmediata a disco
 * (synchronous = OFF) y guardamos el diario en memoria (journal_mode = MEMORY).
 * Esto permite insertar cientos de miles de registros en menos de 1 segundo.
 */
db.exec('PRAGMA synchronous = OFF;');
db.exec('PRAGMA journal_mode = MEMORY;');

/**
 * CREACIÓN DE ESQUEMA:
 * - customers:   30.000 filas. Almacena clientes, nombres, emails y ciudades.
 * - orders:      120.000 filas. Almacena transacciones de compras asociadas a clientes.
 * - order_items: 250.000 filas. Almacena los ítems comprados en cada orden.
 * 
 * NOTA DE ARQUITECTURA:
 * No agregamos índices en customer_id, order_id, order_date ni product_name
 * para que actúe como laboratorio de pruebas de cuello de botella.
 */
db.exec(`
  CREATE TABLE customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    city TEXT NOT NULL,
    country TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    order_date TEXT NOT NULL,
    status TEXT NOT NULL,
    total_amount REAL NOT NULL
  );

  CREATE TABLE order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    category TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL
  );
`);

console.log('Tablas creadas correctamente: customers, orders, order_items (sin índices secundarios).');

// Conjuntos de datos ficticios para enriquecer las consultas analíticas
const firstNames = ['Lucas', 'Camila', 'Mateo', 'Sofia', 'Agustin', 'Valentina', 'Joaquin', 'Martina', 'Santiago', 'Lucia', 'Nicolas', 'Emma', 'Julian', 'Paula', 'Diego', 'Elena', 'Fernando', 'Mariana', 'Esteban', 'Victoria'];
const lastNames = ['Garcia', 'Rodriguez', 'Gonzalez', 'Fernandez', 'Lopez', 'Martinez', 'Sanchez', 'Perez', 'Gomez', 'Diaz', 'Alvarez', 'Romero', 'Sosa', 'Torres', 'Ramirez', 'Flores', 'Benitez', 'Acosta', 'Medina', 'Herrera'];
const cities = ['Buenos Aires', 'Cordoba', 'Rosario', 'Mendoza', 'La Plata', 'Montevideo', 'Santiago', 'Lima', 'Bogota', 'Madrid', 'Barcelona', 'Mexico DF'];
const countries = ['Argentina', 'Uruguay', 'Chile', 'Peru', 'Colombia', 'Espana', 'Mexico'];
const statuses = ['completed', 'pending', 'cancelled', 'processing', 'refunded', 'shipped'];
const categories = ['Electronics', 'Clothing', 'Home & Kitchen', 'Books', 'Sports', 'Beauty', 'Toys', 'Automotive'];
const productBases = ['Wireless Headphones', 'Gaming Keyboard', 'Smartwatch Pro', 'Coffee Maker Deluxe', 'Ergonomic Chair', 'Running Shoes', 'Mechanical Keyboard', '4K Monitor', 'Noise Cancelling Buds', 'Smartphone Case', 'Stainless Steel Bottle', 'Fitness Tracker', 'Bluetooth Speaker', 'Yoga Mat', 'Backpack Ultra'];

// Función de utilidad para seleccionar un elemento al azar de un arreglo
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Genera una fecha aleatoria en formato ISO 'YYYY-MM-DD HH:MM:SS'
function randomDate(startYear = 2023, endYear = 2026) {
  const start = new Date(startYear, 0, 1).getTime();
  const end = new Date(endYear, 11, 31).getTime();
  const date = new Date(start + Math.random() * (end - start));
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

// Definición de volúmenes de datos (~400.000 filas en total)
const TOTAL_CUSTOMERS = 30000;
const TOTAL_ORDERS = 120000;
const TOTAL_ITEMS = 250000;
const TOTAL_RECORDS = TOTAL_CUSTOMERS + TOTAL_ORDERS + TOTAL_ITEMS;

console.log(`Iniciando generación de datos (~${TOTAL_RECORDS.toLocaleString()} registros en total)...`);
const startTime = Date.now();

// ------------------------------------------------------------------------------
// PASO 1: Inserción de Clientes (customers)
// Usamos BEGIN TRANSACTION para empaquetar 30.000 inserts en una única transacción atómica.
// ------------------------------------------------------------------------------
console.log(`Generando ${TOTAL_CUSTOMERS.toLocaleString()} customers...`);
db.exec('BEGIN TRANSACTION;');

// Prepared Statement para compilar la consulta SQL una sola vez en el motor C de SQLite
const insertCustomer = db.prepare(`
  INSERT INTO customers (name, email, city, country, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

for (let i = 1; i <= TOTAL_CUSTOMERS; i++) {
  const fn = randomChoice(firstNames);
  const ln = randomChoice(lastNames);
  const name = `${fn} ${ln}`;
  const email = `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@example.com`;
  const city = randomChoice(cities);
  const country = randomChoice(countries);
  const createdAt = randomDate(2022, 2024);

  // Ejecución de la sentencia preparada
  insertCustomer.run(name, email, city, country, createdAt);
}
db.exec('COMMIT;');
console.log('Customers insertados con éxito.');

// ------------------------------------------------------------------------------
// PASO 2: Inserción de Órdenes de Compra (orders)
// Cada orden apunta a un customer_id entre 1 y TOTAL_CUSTOMERS.
// ------------------------------------------------------------------------------
console.log(`Generando ${TOTAL_ORDERS.toLocaleString()} orders...`);
db.exec('BEGIN TRANSACTION;');

const insertOrder = db.prepare(`
  INSERT INTO orders (customer_id, order_date, status, total_amount)
  VALUES (?, ?, ?, ?)
`);

for (let i = 1; i <= TOTAL_ORDERS; i++) {
  const customerId = Math.floor(Math.random() * TOTAL_CUSTOMERS) + 1;
  const orderDate = randomDate(2023, 2026);
  const status = randomChoice(statuses);
  const totalAmount = parseFloat((Math.random() * 850 + 10).toFixed(2));

  insertOrder.run(customerId, orderDate, status, totalAmount);
}
db.exec('COMMIT;');
console.log('Orders insertadas con éxito.');

// ------------------------------------------------------------------------------
// PASO 3: Inserción de Ítems de Órdenes (order_items)
// Cada ítem apunta a un order_id entre 1 y TOTAL_ORDERS.
// ------------------------------------------------------------------------------
console.log(`Generando ${TOTAL_ITEMS.toLocaleString()} order_items...`);
db.exec('BEGIN TRANSACTION;');

const insertItem = db.prepare(`
  INSERT INTO order_items (order_id, product_name, category, quantity, unit_price)
  VALUES (?, ?, ?, ?, ?)
`);

for (let i = 1; i <= TOTAL_ITEMS; i++) {
  const orderId = Math.floor(Math.random() * TOTAL_ORDERS) + 1;
  const product = randomChoice(productBases);
  const category = randomChoice(categories);
  const quantity = Math.floor(Math.random() * 5) + 1;
  const unitPrice = parseFloat((Math.random() * 150 + 5).toFixed(2));

  insertItem.run(orderId, product, category, quantity, unitPrice);
}
db.exec('COMMIT;');
console.log('Order items insertados con éxito.');

/**
 * RESTAURAR PRAGMAS ESTÁNDAR:
 * Dejamos la base de datos en modo WAL (Write-Ahead Logging) y synchronous NORMAL,
 * el estándar de producción de SQLite para lectura concurrente de alta performance.
 */
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA journal_mode = WAL;');

const duration = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`\n¡Semilla completada exitosamente en ${duration}s!`);
console.log(`- Customers:   ${TOTAL_CUSTOMERS.toLocaleString()}`);
console.log(`- Orders:      ${TOTAL_ORDERS.toLocaleString()}`);
console.log(`- Order Items: ${TOTAL_ITEMS.toLocaleString()}`);
console.log(`- Total filas: ${TOTAL_RECORDS.toLocaleString()}`);

const dbStats = fs.statSync(DB_PATH);
console.log(`- Tamaño archivo DB: ${(dbStats.size / (1024 * 1024)).toFixed(2)} MB`);
