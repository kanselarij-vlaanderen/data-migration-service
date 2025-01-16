const DIRECT_SPARQL_ENDPOINT = process.env.DIRECT_SPARQL_ENDPOINT || 'http://triplestore:8890/sparql';
const USE_DIRECT_QUERIES = isTruthy(process.env.USE_DIRECT_QUERIES);
const NB_OF_QUERY_RETRIES = parseInt(process.env.NB_OF_QUERY_RETRIES || '6');
const RETRY_TIMEOUT_MS = parseInt(process.env.RETRY_TIMEOUT_MS || '1000');
const DELTA_INTERVAL_MS = parseInt(process.env.DELTA_INTERVAL_MS || '60000');

const KEEP_TEMP_GRAPH = isTruthy(process.env.KEEP_TEMP_GRAPH);

const LOG_DIRECT_QUERIES = isTruthy(process.env.LOG_DIRECT_QUERIES);
const LOG_SPARQL_ALL = isTruthy(process.env.LOG_SPARQL_ALL);
const LOG_INCOMING_DELTA = isTruthy(process.env.LOG_INCOMING_DELTA);
const LOG_DELTA_PROCESSING = isTruthy(process.env.LOG_DELTA_PROCESSING || "true");
const LOG_INITIALIZATION = isTruthy(process.env.LOG_INITIALIZATION);

let RELOAD_ON_INIT = [];
if (isTruthy(process.env.RELOAD_ON_INIT)) {
  RELOAD_ON_INIT = ['intern-overheid', 'intern-regering', 'minister'];
} else {
  RELOAD_ON_INIT = (process.env.RELOAD_ON_INIT || '').split(',').filter(g => g).map(g => g.trim());
}

const MU_AUTH_PAGE_SIZE = parseInt(process.env.MU_AUTH_PAGE_SIZE || '2500');
const VIRTUOSO_RESOURCE_PAGE_SIZE = parseInt(process.env.VIRTUOSO_RESOURCE_PAGE_SIZE || '10000');
const VALUES_BLOCK_SIZE = parseInt(process.env.VALUES_BLOCK_SIZE || '100');

function isTruthy(value) {
  return [true, 'true', 1, '1', 'yes', 'Y', 'on'].includes(value);
}

export {
  DIRECT_SPARQL_ENDPOINT,
  USE_DIRECT_QUERIES,
  NB_OF_QUERY_RETRIES,
  RETRY_TIMEOUT_MS,
  DELTA_INTERVAL_MS,
  KEEP_TEMP_GRAPH,
  LOG_DIRECT_QUERIES,
  LOG_SPARQL_ALL,
  LOG_INCOMING_DELTA,
  LOG_DELTA_PROCESSING,
  LOG_INITIALIZATION,
  RELOAD_ON_INIT,
  MU_AUTH_PAGE_SIZE,
  VIRTUOSO_RESOURCE_PAGE_SIZE,
  VALUES_BLOCK_SIZE
}
