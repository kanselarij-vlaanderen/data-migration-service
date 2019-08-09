import mu from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
mu.query = querySudo;

const parseSparQlResults = (data, multiValueProperties = []) => {
	const vars = data.head.vars;
	return data.results.bindings.map(binding => {
		let obj = {};

		vars.forEach(varKey => {
			if (binding[varKey]){
				let val = binding[varKey].value;
				if (multiValueProperties.includes(varKey)){
					val = val.split('|')
				}
				obj[varKey] = val;
			}else {
				obj[varKey] = null;
			}
		});
		return obj;
	})
};

const removeInfoNotInTemp = (queryEnv) => {
  const query = `
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  DELETE {
    GRAPH <${queryEnv.targetGraph}> {
      ?s ?p ?o.
    }
  } WHERE {
    GRAPH <${queryEnv.targetGraph}> {
			?s ?p ?o.
			?s a ?type.

      FILTER NOT EXISTS {
        GRAPH <${queryEnv.tempGraph}> {
          ?s ?p ?o.
        }
      }
    }
  }`;
  return queryEnv.run(query);
};

const notConfidentialFilter = `
    FILTER NOT EXISTS {
      ?s ext:vertrouwelijk "true"^^<http://mu.semte.ch/vocabularies/typed-literals/boolean> .
    }
`;

const notBeperktOpenbaarFilter = `
    FILTER NOT EXISTS {
      ?s ?accessPredicate <http://kanselarij.vo.data.gift/id/concept/toegangs-niveaus/abe4c18d-13a9-45f0-8cdd-c493eabbbe29> .
      FILTER(?accessPredicate in (
        <http://mu.semte.ch/vocabularies/ext/toegangsniveauVoorProcedurestap>, 
        <http://mu.semte.ch/vocabularies/ext/toegangsniveauVoorDocument>,
        <http://mu.semte.ch/vocabularies/ext/toegangsniveauVoorDossier> ))
    }
`;

const notInternOverheidFilter = `
    FILTER NOT EXISTS {
      ?s ?accessPredicate <http://kanselarij.vo.data.gift/id/concept/toegangs-niveaus/d335f7e3-aefd-4f93-81a2-1629c2edafa3> .
      FILTER(?accessPredicate in (
        <http://mu.semte.ch/vocabularies/ext/toegangsniveauVoorProcedurestap>, 
        <http://mu.semte.ch/vocabularies/ext/toegangsniveauVoorDocument>,
        <http://mu.semte.ch/vocabularies/ext/toegangsniveauVoorDossier> ))
    }
`;

const addRelatedFiles = (queryEnv, extraFilters) => {
	extraFilters = extraFilters || '';

  const query = `
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  INSERT {
    GRAPH <${queryEnv.tempGraph}> {
      ?s a nfo:FileDataObject .
      ?second a nfo:FileDataObject .
    }
  } WHERE {
    GRAPH <${queryEnv.tempGraph}> {
      ?target a ?targetClass .
    }
    GRAPH <${queryEnv.adminGraph}> {
      ?s a nfo:FileDataObject .
      ?target ext:file ?s.

      OPTIONAL {
        ?second <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#dataSource> ?s.
      }

      ${extraFilters}
    }
  }`;
  return queryEnv.run(query);
};

const cleanup = (queryEnv) => {
  const query = `
  DROP GRAPH <${queryEnv.tempGraph}>`;
  return queryEnv.run(query, true);
};

const fillOutDetailsOnVisibleItems = (queryEnv) => {
  const query = `
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  INSERT {
    GRAPH <${queryEnv.tempGraph}> {
      ?s a ?thing.
      ?s ?p ?o.
      ?oo ?pp ?s.
      ?s ?p ?literalo.
    }
    GRAPH <${queryEnv.targetGraph}> {
      ?s a ?thing.
      ?s ?p ?o.
      ?oo ?pp ?s.
      ?s ?p ?literalo.
    }
  } WHERE {
    GRAPH <${queryEnv.adminGraph}> {
      ?s a ?thing.
      GRAPH <${queryEnv.tempGraph}> {
        ?s a ?thing .
      }
      ?s ?p ?literalo.
      FILTER(isLiteral(?literalo))
      OPTIONAL {
        ?oo ?pp ?s.
        GRAPH <${queryEnv.tempGraph}> {
          ?oo a ?oothing.
        }
      }
      OPTIONAL {
        ?s ?p ?o.
        GRAPH <${queryEnv.tempGraph}> {
          ?o a ?othing.
        }
      }
    }
  }`;
  return queryEnv.run(query);
};

const addAllRelatedDocuments = (queryEnv, extraFilters) => {
	extraFilters = extraFilters || '';
  const query = `
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  INSERT {
    GRAPH <${queryEnv.tempGraph}> {
      ?s a ?thing .
      ?version a ?subthing .
    }
  } WHERE {
    GRAPH <${queryEnv.tempGraph}> {
      ?target a ?targetClass .
    }
    GRAPH <${queryEnv.adminGraph}> {
      ?s a ?thing .
      ?target ?p ?s .

      FILTER( ?thing IN(
        foaf:Document,
        ext:DocumentVersie ) )

      ${extraFilters}

      OPTIONAL {
        ?s besluitvorming:heeftVersie ?version.
        ?version a ?subthing.
      }
    }
  }`;
  return queryEnv.run(query);
};

const addAllRelatedToAgenda = (queryEnv, extraFilters) => {
	extraFilters = extraFilters || '';
  const query = `
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  INSERT {
    GRAPH <${queryEnv.tempGraph}> {
      ?s a ?thing .
    }
  } WHERE {
    GRAPH <${queryEnv.tempGraph}> {
      ?agenda a besluitvorming:Agenda .
    }
    GRAPH <${queryEnv.adminGraph}> {
      ?s a ?thing .
      { { ?s ?p ?agenda } 
        UNION 
        { ?agenda ?p ?s } 
        UNION
        { ?agenda dct:hasPart ?agendaItem .
          ?s besluitvorming:isGeagendeerdVia ?agendaItem .
        }
      }
      FILTER( ?thing NOT IN(besluitvorming:Agenda) )
      ${extraFilters}
    }
  }`;
  return queryEnv.run(query);
};

const addRelatedToAgendaItemAndSubcase = (queryEnv, extraFilters) => {
	extraFilters = extraFilters || '';

  const query = `
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX dbpedia: <http://dbpedia.org/ontology/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  INSERT {
    GRAPH <${queryEnv.tempGraph}> {
      ?s a ?thing .
    }
  } WHERE {
    GRAPH <${queryEnv.tempGraph}> {
      ?target a ?targetClass .
      FILTER(?targetClass IN (besluit:Agendapunt, dbpedia:UnitOfWork))
    }
    GRAPH <${queryEnv.adminGraph}> {
      ?s a ?thing .
      { { ?s ?p ?target } UNION { ?target ?p ?s } }
      FILTER( ?thing NOT IN(
        besluitvorming:Agenda,
        besluit:AgendaItem,
        dbpedia:UnitOfWork,
        foaf:Document,
        ext:DocumentVersie,
        nfo:FileDataObject ) )

      ${extraFilters}

    }
  }`;
  return queryEnv.run(query);
};

module.exports = {
	parseSparQlResults,
	removeInfoNotInTemp,
	notConfidentialFilter,
	notBeperktOpenbaarFilter,
	notInternOverheidFilter,
	addRelatedFiles,
	cleanup,
	fillOutDetailsOnVisibleItems,
	addAllRelatedDocuments,
	addAllRelatedToAgenda,
	addRelatedToAgendaItemAndSubcase
};

