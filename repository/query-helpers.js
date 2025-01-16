import { sparqlEscape, sparqlEscapeUri } from 'mu';
import { querySudo as query, updateSudo as update } from './auth-sudo';
import { MU_AUTH_PAGE_SIZE } from '../config';

/**
 * Convert results of select query to an array of objects.
 * @method parseResult
 * @return {Array}
 */
function parseResult(result) {
  const bindingKeys = result.head.vars;
  return result.results.bindings.map((row) => {
    const obj = {};
    bindingKeys.forEach((key) => {
      if (row[key]) {
        obj[key] = row[key].value;
      } else {
        obj[key] = null;
      }
    });
    return obj;
  });
};

async function countTriples({ graph, subject = null, predicate = null, object = null, objectType = null }) {
  const subjectVar = subject ? `${sparqlEscapeUri(subject)}` : '?s';
  const predicateVar = predicate ? `${sparqlEscapeUri(predicate)}` : '?p';
  const objectVar = object ? `${sparqlEscape(object, objectType ?? 'uri')}` : '?o';
  const queryResult = await query(`
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    SELECT (COUNT(*) as ?count)
    WHERE {
      GRAPH <${graph}> {
        ${subjectVar} ${predicateVar} ${objectVar} .
      }
    }
  `);

  return parseInt(queryResult.results.bindings[0].count.value);
}

async function countResources({ graph, type = null, lineage = null }) {
  const statements = [];
  if (type)
    statements.push(`?s a <${type}> .`);
  else
    statements.push(`?s a ?type .`);

  if (lineage)
    statements.push(`?s ext:tracesLineageTo <${lineage}> .`);

  const queryResult = await query(`
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    SELECT (COUNT(DISTINCT ?s) as ?count)
    WHERE {
      GRAPH <${graph}> {
        ${statements.join('\n')}
      }
    }
  `);

  return parseInt(queryResult.results.bindings[0].count.value);
}

async function deleteResource(subject, graph, { inverse } = {}) {
  let count = 0;
  let offset = 0;
  let deleteStatement = null;
  if (inverse) {
    const object = subject;
    count = await countTriples({ graph, object });
    deleteStatement = `
      DELETE {
        GRAPH <${graph}> {
          ?s ?p ${sparqlEscapeUri(object)} .
        }
      }
      WHERE {
        GRAPH <${graph}> {
          SELECT ?s ?p
            WHERE { ?s ?p ${sparqlEscapeUri(object)} . }
            LIMIT ${MU_AUTH_PAGE_SIZE}
        }
      }
    `;
  } else {
    count = await countTriples({ graph, subject });
    // Note: no OFFSET needed in the subquery. Pagination is inherent since
    // the WHERE clause doesn't match any longer for triples that are deleted
    // in the previous batch.
    deleteStatement = `
      DELETE {
        GRAPH <${graph}> {
          ${sparqlEscapeUri(subject)} ?p ?o .
        }
      }
      WHERE {
        GRAPH <${graph}> {
          SELECT ?p ?o
            WHERE { ${sparqlEscapeUri(subject)} ?p ?o . }
            LIMIT ${MU_AUTH_PAGE_SIZE}
        }
      }
    `;
  }

  while (offset < count) {
    await update(deleteStatement);
    offset = offset + MU_AUTH_PAGE_SIZE;
  }
}

export {
  parseResult,
  countTriples,
  countResources,
  deleteResource
}
