#!/usr/bin/env node

/**
 * ==============================================================================
 * SERVIDOR MCP (MODEL CONTEXT PROTOCOL): OPTIMIZADOR SQL PARA AGENTES
 * Archivo: src/mcp-server.js
 * ==============================================================================
 * 
 * ¿QUÉ ES Y CÓMO FUNCIONA?
 * Model Context Protocol (MCP) es un estándar abierto desarrollado por Anthropic
 * y adoptado por Google Antigravity para permitir que modelos de IA interactúen
 * de forma segura con herramientas, archivos y bases de datos locales.
 * 
 * MECANISMO DE TRANSPORTE (stdio):
 * Este servidor se ejecuta como un proceso hijo del asistente (Antigravity).
 * La comunicación ocurre mediante mensajes JSON-RPC enviados a través de
 * la entrada estándar (process.stdin) y salida estándar (process.stdout).
 * 
 * HERRAMIENTAS EXPUESTAS AL AGENTE:
 * 1. get_schema: Inspecciona la estructura relacional (tablas, columnas, índices).
 * 2. explain_query_plan: Extrae el plan de ejecución SQLite para detectar SCAN TABLE.
 * 3. execute_query: Ejecuta SELECTs reales y mide los milisegundos consumidos.
 * 4. execute_ddl: Permite al agente crear índices (CREATE INDEX) o borrarlos (DROP INDEX).
 * ==============================================================================
 */

// Importaciones del SDK oficial de MCP para TypeScript/JavaScript
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

// Importaciones para manejo del motor SQLite nativo y sistema de archivos
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

/**
 * RESOLUCIÓN DE RUTA DE BASE DE DATOS:
 * Si se especifica la variable de entorno DB_PATH (desde mcp_config.json),
 * se resuelve de forma absoluta. En caso contrario, busca 'ecommerce.db'
 * en la raíz del proyecto.
 */
const DB_PATH = process.env.DB_PATH 
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.join(__dirname, '..', 'ecommerce.db');

// Validación temprana para registrar si la base aún no ha sido sembrada
if (!fs.existsSync(DB_PATH)) {
  console.error(`[mcp-server] ADVERTENCIA: Base de datos no encontrada en ${DB_PATH}. Ejecuta 'npm run seed' para crearla.`);
}

/**
 * GESTIÓN DE CONEXIÓN A BASE DE DATOS (Singleton):
 * Mantiene una única instancia abierta de DatabaseSync para todas las herramientas.
 */
let db;
function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
  }
  return db;
}

/**
 * INSTANCIACIÓN DEL SERVIDOR MCP:
 * Declaramos el nombre del servidor y publicamos la capacidad "tools", indicando
 * al agente que este servidor provee herramientas ejecutables.
 */
const server = new Server(
  {
    name: 'sqlite-db-optimizer',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {}, // Declara soporte para invocar herramientas
    },
  }
);

/**
 * REGISTRO DEL CATÁLOGO DE HERRAMIENTAS (tools/list):
 * Cuando el agente se conecta, envía una petición ListToolsRequestSchema.
 * El servidor responde con los metadatos y esquemas JSON Schema de cada herramienta.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'execute_query',
        description: 'Ejecuta una consulta SQL SELECT en la base de datos SQLite y retorna los resultados junto con el tiempo exacto de ejecución en milisegundos y conteo de filas.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Sentencia SQL SELECT a ejecutar.',
            },
            limit: {
              type: 'number',
              description: 'Número máximo de registros a retornar (por defecto 50 para no saturar contexto).',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'explain_query_plan',
        description: 'Ejecuta EXPLAIN QUERY PLAN para una consulta SQL y retorna la estructura del plan de ejecución del motor SQLite (detecta SCAN TABLE vs SEARCH TABLE USING INDEX).',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Consulta SQL SELECT a analizar con EXPLAIN QUERY PLAN.',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'execute_ddl',
        description: 'Ejecuta sentencias DDL (CREATE INDEX, DROP INDEX, ANALYZE) para probar estrategias de optimización y medir el tiempo de creación de índices.',
        inputSchema: {
          type: 'object',
          properties: {
            sql: {
              type: 'string',
              description: 'Sentencia SQL DDL a ejecutar (e.g., CREATE INDEX idx_orders_date ON orders(order_date)).',
            },
          },
          required: ['sql'],
        },
      },
      {
        name: 'get_schema',
        description: 'Obtiene el esquema completo de la base de datos (tablas, columnas, tipos de datos, conteo de filas e índices actuales).',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

/**
 * EJECUTOR DE HERRAMIENTAS (tools/call):
 * Cuando el agente decide invocar una herramienta, envía un mensaje CallToolRequestSchema
 * con el nombre y los argumentos validados.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const database = getDb();

  try {
    switch (name) {
      // ------------------------------------------------------------------------
      // HERRAMIENTA 1: execute_query
      // Ejecuta SELECTs y mide latencia exacta con performance.now()
      // ------------------------------------------------------------------------
      case 'execute_query': {
        const query = (args.query || '').trim();
        const limit = typeof args.limit === 'number' ? args.limit : 50;

        const start = performance.now();
        const stmt = database.prepare(query);
        const allResults = stmt.all();
        const durationMs = Number((performance.now() - start).toFixed(2));

        // Acotamos el resultado devuelto para proteger la ventana de contexto del LLM
        const slicedResults = allResults.slice(0, limit);

        const responseText = [
          `⏱️ Tiempo de ejecución: ${durationMs} ms`,
          `📊 Filas encontradas: ${allResults.length} (mostrando ${slicedResults.length})`,
          '',
          'Resultados:',
          JSON.stringify(slicedResults, null, 2),
        ].join('\n');

        return {
          content: [
            {
              type: 'text',
              text: responseText,
            },
          ],
        };
      }

      // ------------------------------------------------------------------------
      // HERRAMIENTA 2: explain_query_plan
      // Solicita al optimizador de costos de SQLite el plan de ejecución y añade
      // un diagnóstico automático si detecta escaneos secuenciales completos.
      // ------------------------------------------------------------------------
      case 'explain_query_plan': {
        const query = (args.query || '').trim();
        const explainQuery = `EXPLAIN QUERY PLAN ${query}`;
        const stmt = database.prepare(explainQuery);
        const planRows = stmt.all();

        const formattedPlan = planRows.map((r) => `[id:${r.id}, parent:${r.parent}] ${r.detail}`).join('\n');

        // Detección de patrones ineficientes en SQLite
        const hasFullScan = planRows.some((r) => r.detail.includes('SCAN TABLE') || r.detail.includes('SCAN '));
        const scanWarning = hasFullScan
          ? '⚠️ ALERTA: Se detectaron escaneos secuenciales completos (SCAN TABLE). Sugerencia: evaluar índices para las columnas en cláusulas WHERE o JOIN.'
          : '⚡ ÓPTIMO: La consulta utiliza índices o búsquedas directas (SEARCH TABLE).';

        return {
          content: [
            {
              type: 'text',
              text: `Plan de ejecución:\n${formattedPlan}\n\nDiagnóstico preliminar:\n${scanWarning}`,
            },
          ],
        };
      }

      // ------------------------------------------------------------------------
      // HERRAMIENTA 3: execute_ddl
      // Permite modificar el esquema para añadir o quitar índices y comprobar
      // el impacto inmediato en el profiling.
      // ------------------------------------------------------------------------
      case 'execute_ddl': {
        const sql = (args.sql || '').trim();
        const start = performance.now();
        database.exec(sql);
        const durationMs = Number((performance.now() - start).toFixed(2));

        return {
          content: [
            {
              type: 'text',
              text: `✅ Sentencia DDL ejecutada con éxito en ${durationMs} ms.\nSQL: ${sql}`,
            },
          ],
        };
      }

      // ------------------------------------------------------------------------
      // HERRAMIENTA 4: get_schema
      // Inspecciona metadatos del catálogo SQLite (sqlite_master, PRAGMA table_info,
      // PRAGMA index_list) para proveer un panorama completo del estado actual.
      // ------------------------------------------------------------------------
      case 'get_schema': {
        const tablesQuery = `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';`;
        const tables = database.prepare(tablesQuery).all();

        const schemaDetails = [];

        for (const t of tables) {
          const tableName = t.name;

          // Cantidad de registros actual
          const countStmt = database.prepare(`SELECT COUNT(*) as count FROM "${tableName}";`);
          const rowCount = countStmt.get().count;

          // Definición de columnas
          const colsStmt = database.prepare(`PRAGMA table_info("${tableName}");`);
          const cols = colsStmt.all().map((c) => `${c.name} (${c.type}${c.pk ? ' PK' : ''})`).join(', ');

          // Lista de índices secundarios creados
          const idxStmt = database.prepare(`PRAGMA index_list("${tableName}");`);
          const indices = idxStmt.all().map((idx) => idx.name).join(', ') || 'Sin índices secundarios';

          schemaDetails.push({
            table: tableName,
            rowCount,
            columns: cols,
            indexes: indices,
          });
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(schemaDetails, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Herramienta no implementada: ${name}`);
    }
  } catch (error) {
    // Retorno de error estructurado compatible con la especificación MCP
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `❌ Error al ejecutar herramienta '${name}': ${error.message}`,
        },
      ],
    };
  }
});

/**
 * ARRANQUE DEL SERVIDOR:
 * Se asocia el transporte stdio y se conecta el servidor.
 * A partir de este momento, escucha comandos JSON-RPC por stdin.
 */
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

run().catch((err) => {
  console.error('[mcp-server] Error fatal iniciando servidor MCP:', err);
  process.exit(1);
});
