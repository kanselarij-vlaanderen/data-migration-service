import { uuid } from 'mu';
import { querySudo, updateSudo } from './auth-sudo';
import { queryTriplestore, updateTriplestore } from './triplestore';
import { runStage, forLoopProgressBar } from './timing';
import { countResources, deleteResource } from './query-helpers';
import { USE_DIRECT_QUERIES, MU_AUTH_PAGE_SIZE, VIRTUOSO_RESOURCE_PAGE_SIZE, KEEP_TEMP_GRAPH } from '../config';

class Distributor {
  constructor({ sourceGraph, targetGraph }) {
    this.sourceGraph = sourceGraph;
    this.targetGraph = targetGraph;
    this.tempGraph = `http://mu.semte.ch/graphs/temp/${uuid()}`;

    this.releaseOptions = {
      validateDecisionsRelease: false,
      validateDocumentsRelease: false
    };
  }

  async perform(options = { agendaUris: [], isInitialDistribution: false }) {
    if (this.collect) {
      console.log(`${this.constructor.name} started at ${new Date().toISOString()}`);

      await runStage(`Register temp graph <${this.tempGraph}>`, async () => {
        await this.registerTempGraph();
      });

      // resource collection logic implemented by subclass
      const hasCollectedResources = await this.collect(options);

      if (hasCollectedResources) {
        await runStage('Collect resource details', async () => {
          await this.collectResourceDetails();
        }, this.constructor.name);

        await runStage('Filter out unwanted triples', async () => {
          await this.filterCollectedDetails();
        }, this.constructor.name);

        await runStage('Filter out unwanted publication-flow triples', async () => {
          await this.filterPublicationFlows();
        }, this.constructor.name);

        await runStage('Workaround for cache issue', async () => {
          await this.filterEmptyTreatments();
        }, this.constructor.name);

        if (!options.isInitialDistribution) {
          await runStage('Cleanup previously published data', async () => {
            await this.cleanupPreviouslyPublishedData();
          }, this.constructor.name);
        }

        await runStage(`Copy temp graph to <${this.targetGraph}>`, async () => {
          await this.copyTempGraph();
        });
      } else {
        console.log('No resources collected in temp graph');
      }

      if (KEEP_TEMP_GRAPH) {
        console.log(`Service configured not to cleanup temp graph. Graph <${this.tempGraph}> will remain in triplestore.`);
      } else {
        await runStage(`Delete temp graph <${this.tempGraph}>`, async () => {
          await updateTriplestore(`DROP SILENT GRAPH <${this.tempGraph}>`);
        });
      }

      console.log(`${this.constructor.name} ended at ${new Date().toISOString()}`);
    } else {
      console.warn(`Distributor ${this.constructor.name} doesn't contain a function this.collect(). Nothing to perform.`);
    }
  }

  async registerTempGraph() {
    await updateTriplestore(`
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
      INSERT DATA {
        GRAPH <${this.tempGraph}> {
          <${this.tempGraph}> a ext:TempGraph .
        }
      }`);
  }

  /*
   * Copy all incoming and outgoing triples of the collected resources in temp graph.
   * Note, the copy operation must be executed in batches using a subquery.
   * The number of triples selected in the subquery (= VIRTUOSO_RESOURCE_PAGE_SIZE * triples_for_resource
   * should not exceed the maximum number of triples returned by the database
   * (ie. ResultSetMaxRows in Virtuoso).
   *
   * Using subquery to select all distinct subjects.
   * More info: http://vos.openlinksw.com/owiki/wiki/VOS/VirtTipsAndTricksHowToHandleBandwidthLimitExceed
  */
  async collectResourceDetails() {
    const summary = await queryTriplestore(`
      SELECT (COUNT(?s) AS ?count) ?type WHERE {
        GRAPH <${this.tempGraph}> {
          ?s a ?type .
        }
      } GROUP BY ?type ORDER BY ?type`);

    console.log(`Temp graph <${this.tempGraph}> summary`);
    summary.results.bindings.forEach(binding => {
      console.log(`\t[${binding['count'].value}] ${binding['type'].value}`);
    });

    const types = summary.results.bindings.map(b => b['type'].value);

    // We are not interested in redistributing certain types because
    // they hold the same resource triples attached to another type.
    // E.g. the triples of a resource gathered from prov:Activity or from
    // besluitvorming:Agendering are identical. Distributing both is a
    // waste of work for Yggdrasil.
    const skippedTypes = ['http://www.w3.org/ns/prov#Activity'];

    for (let type of types) {
      if (skippedTypes.includes(type)) {
        console.log(`Skipping detail collection of type <${type}>`);
        continue;
      }

      const count = await countResources({ graph: this.tempGraph, type: type });

      const limit = VIRTUOSO_RESOURCE_PAGE_SIZE;
      const totalBatches = Math.ceil(count / limit);
      let currentBatch = 0;
      while (currentBatch < totalBatches) {
        await runStage(`Collect details of <${type}> (batch ${currentBatch + 1}/${totalBatches})`, async () => {
          const offset = limit * currentBatch;

          // Outgoing triples
          await updateTriplestore(`
            INSERT {
              GRAPH <${this.tempGraph}> {
                ?resource ?p ?o .
              }
            } WHERE {
              {
                SELECT DISTINCT ?resource {
                  GRAPH <${this.tempGraph}> {
                    ?resource a <${type}> .
                  }
                } ORDER BY ?resource LIMIT ${limit} OFFSET ${offset}
              }
              GRAPH <${this.sourceGraph}> {
                ?resource a <${type}> . # for Virtuoso performance
                ?resource ?p ?o .
              }
            }`);

          // Incoming triples
          await updateTriplestore(`
            INSERT {
              GRAPH <${this.tempGraph}> {
                ?s ?p ?resource .
              }
            } WHERE {
              {
                SELECT DISTINCT ?resource {
                  GRAPH <${this.tempGraph}> {
                    ?resource a <${type}> .
                  }
                } ORDER BY ?resource LIMIT ${limit} OFFSET ${offset}
              }
              GRAPH <${this.sourceGraph}> {
                ?resource a <${type}> . # for Virtuoso performance
                ?s ?p ?resource .
              }
            }`)
        });

        currentBatch++;
      }
    }
  }

  /**
   * Filter out unwanted triples from the temp graph.
   * This is used to remove triples that we don't want to propagate to other graphs,
   * without impacting the performance of the query in collectResourceDetails by adding FILTER statements.
   */
  async filterCollectedDetails() {
    let offset = 0;
    const summary = await queryTriplestore(`
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    SELECT (COUNT(?s) AS ?count) WHERE {
      GRAPH <${this.tempGraph}> {
        ?s a besluit:Agendapunt .
        ?s ext:privateComment ?o .
      }
    }`);
    const count = summary.results.bindings.map(b => b['count'].value);

    const deleteStatement =`
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    DELETE {
      GRAPH <${this.tempGraph}> {
        ?s ext:privateComment ?o .
      }
    }
    WHERE {
      GRAPH <${this.tempGraph}> {
        SELECT ?s ?o {
          ?s a besluit:Agendapunt .
          ?s ext:privateComment ?o .
        }
        LIMIT ${MU_AUTH_PAGE_SIZE}
      }
    }`;

    while (offset < count) {
      await updateTriplestore(deleteStatement);
      offset = offset + MU_AUTH_PAGE_SIZE;
    }
  }

  /**
   * Filter out unwanted triples related to publication-flows from the temp graph.
   * We only want to propagate a subset of data about publcation-flows to other
   * graphs, this function is used to remove the unwanted triples without
   * impacting the performance of the query in collectResourceDetails by adding
   * FILTER statements.
   */
  async filterPublicationFlows() {
    let offset = 0;
    const summary = await queryTriplestore(`
    PREFIX pub: <http://mu.semte.ch/vocabularies/ext/publicatie/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX fabio: <http://purl.org/spar/fabio/>
    PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX tmo: <http://www.semanticdesktop.org/ontologies/2008/05/20/tmo#>

    SELECT (COUNT(?o) AS ?count) WHERE {
      GRAPH <${this.tempGraph}> {
        ?s a ?type .
        VALUES ?type {
          pub:Publicatieaangelegenheid
          pub:VertalingProcedurestap
          pub:PublicatieProcedurestap
          pub:VertaalActiviteit
          pub:DrukproefActiviteit
          pub:PublicatieActiviteit
        }
        { ?s rdfs:comment ?o }
        UNION { ?s dossier:openingsdatum ?o }
        UNION { ?s dossier:sluitingsdatum ?o }
        UNION { ?s fabio:hasPageCount ?o }
        UNION { ?s pub:aantalUittreksels ?o }
        UNION { ?s pub:publicatieWijze ?o }
        UNION { ?s pub:urgentieniveau ?o }
        UNION { ?s prov:hadActivity ?o }
        UNION { ?s pub:threadId ?o }
        UNION { ?s pub:doorlooptVertaling ?o }
        UNION { ?s pub:doorlooptPublicatie ?o }
        UNION { ?s dct:created ?o }
        UNION { ?s dossier:Procedurestap.startdatum ?o }
        UNION { ?s dossier:Procedurestap.einddatum ?o }
        UNION { ?s tmo:targetEndTime ?o }
        UNION { ?s tmo:dueDate ?o }
        UNION { ?s pub:drukproefVerbeteraar ?o }
        UNION { ?s pub:vertalingsactiviteitVanAanvraag ?o }
        UNION { ?s pub:doelTaal ?o }
        UNION { ?s pub:vertalingGebruikt ?o }
        UNION { ?s pub:vertalingGenereert ?o }
        UNION { ?s pub:drukproefGebruikt ?o }
        UNION { ?s pub:drukproefGenereert ?o }
        UNION { ?s pub:drukproefactiviteitVanAanvraag ?o }
        UNION { ?s pub:publicatieGebruikt ?o }
        UNION { ?s prov:generated ?o }
        UNION { ?s pub:publicatieactiviteitVanAanvraag ?o }
      }
    }`);
    const count = summary.results.bindings.map(b => b['count'].value);

    const deleteStatement =`
    PREFIX pub: <http://mu.semte.ch/vocabularies/ext/publicatie/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX fabio: <http://purl.org/spar/fabio/>
    PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX tmo: <http://www.semanticdesktop.org/ontologies/2008/05/20/tmo#>
    DELETE {
      GRAPH <${this.tempGraph}> {
        ?s ?p ?o .
      }
    }
    WHERE {
      GRAPH <${this.tempGraph}> {
        SELECT ?s ?p ?o {
          VALUES ?p {
            rdfs:comment
            dossier:openingsdatum
            dossier:sluitingsdatum
            fabio:hasPageCount
            pub:aantalUittreksels
            pub:publicatieWijze
            pub:urgentieniveau
            prov:hadActivity
            pub:threadId
            dct:created
            dossier:Procedurestap.startdatum
            dossier:Procedurestap.einddatum
            tmo:targetEndTime
            tmo:dueDate
            pub:drukproefVerbeteraar
            pub:vertalingsactiviteitVanAanvraag
            pub:doelTaal
            pub:vertalingGebruikt
            pub:vertalingGenereert
            pub:drukproefGebruikt
            pub:drukproefGenereert
            pub:drukproefactiviteitVanAanvraag
            pub:publicatieGebruikt
            prov:generated
            pub:publicatieactiviteitVanAanvraag
          }
          VALUES ?type {
            pub:Publicatieaangelegenheid
            pub:VertalingProcedurestap
            pub:PublicatieProcedurestap
            pub:VertaalActiviteit
            pub:DrukproefActiviteit
            pub:PublicatieActiviteit
          }
          ?s a ?type .
          OPTIONAL { ?s ?p ?o }
        }
        LIMIT ${MU_AUTH_PAGE_SIZE}
      }
    }`;

    while (offset < count) {
      await updateTriplestore(deleteStatement);
      offset = offset + MU_AUTH_PAGE_SIZE;
    }
  }

  /**
   * Filter out a triple pointing to an empty treatment from the temp graph.
   * This is used to counter the cache issue when adding treatments to a graph on a later run than the agendaitems,
   * without impacting the performance of the query in collectResourceDetails by adding FILTER statements.
   */
    async filterEmptyTreatments() {
    let offset = 0;
    const summary = await queryTriplestore(`
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    PREFIX dct: <http://purl.org/dc/terms/>
    SELECT (COUNT(?s) AS ?count) WHERE {
      GRAPH <${this.tempGraph}> {
        ?s a besluit:Agendapunt .
        ?o dct:subject ?s .
        FILTER NOT EXISTS { ?o a besluit:BehandelingVanAgendapunt .}
      }
    }`);
    const count = summary.results.bindings.map(b => b['count'].value);

    const deleteStatement =`
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    PREFIX dct: <http://purl.org/dc/terms/>
    DELETE {
      GRAPH <${this.tempGraph}> {
        ?o dct:subject ?s .
      }
    }
    WHERE {
      GRAPH <${this.tempGraph}> {
        SELECT ?s ?o {
          ?s a besluit:Agendapunt .
          ?o dct:subject ?s .
          FILTER NOT EXISTS { ?o a besluit:BehandelingVanAgendapunt .}
        }
        LIMIT ${MU_AUTH_PAGE_SIZE}
      }
    }`;

    while (offset < count) {
      await updateTriplestore(deleteStatement);
      offset = offset + MU_AUTH_PAGE_SIZE;
    }
  }

  /*
   * Step 1: Find all resources that have been published before with lineage to an agenda
   * that is in scope of this distribution process, but don't have any lineage in
   * the current tempGraph. This means the resource should no longer be visible.
   * Otherwise it would have been included in the tempGraph.
   *
   * Step 2: Find all resources that have been published before with lineage to an agenda
   * that is in scope of this distribution process, but have at least 1 property, that is not a lineage,
   * that is not in the temp graph anymore. This means the published property is stale
   * and must be removed. Otherwise it would have been included in the tempGraph.
   *
   * Step 3: Find all resources that have been published before with lineage to an agenda
   * that is in scope of this distribution process, but don't have lineage to that same
   * agenda in the current tempGraph. This means the resource should still be visible,
   * since it's included in the tempGraph, but it's published lineage must be updated.
  */
  async cleanupPreviouslyPublishedData() {
    // Step 1
    const cleanupResourcesQuery = `
      PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
      SELECT DISTINCT ?published
      WHERE {
        GRAPH <${this.targetGraph}> {
          ?published ext:tracesLineageTo ?agenda .
        }
        GRAPH <${this.tempGraph}> {
          ?agenda a besluitvorming:Agenda .
          FILTER NOT EXISTS {
            ?published ext:tracesLineageTo ?anyAgenda .
          }
        }
      }
    `;
    let result = await queryTriplestore(cleanupResourcesQuery);
    let resources = result.results.bindings.map(b => b['published'].value);
    console.log(`Cleanup ${resources.length} published resources that should no longer be visible`);
    await forLoopProgressBar(resources, async (resource) => {
      await deleteResource(resource, this.targetGraph);
      await deleteResource(resource, this.targetGraph, { inverse: true });
    });

    // Step 2
    const cleanupStalePropertiesQuery = `
      PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
      SELECT DISTINCT ?published
      WHERE {
        GRAPH <${this.tempGraph}> {
          ?agenda a besluitvorming:Agenda .
        }
        {
          {
            GRAPH <${this.targetGraph}> {
              ?published ext:tracesLineageTo ?agenda ;
                 ?p ?o .
              FILTER(?p != ext:tracesLineageTo)
            }
            FILTER NOT EXISTS {
              GRAPH <${this.tempGraph}> {
                ?published ?p ?o .
              }
            }
          }
          UNION
          {
            GRAPH <${this.targetGraph}> {
              ?published ext:tracesLineageTo ?agenda .
                 ?s ?p ?published .
              FILTER(?p != ext:tracesLineageTo)
            }
            FILTER NOT EXISTS {
              GRAPH <${this.tempGraph}> {
                ?s ?p ?published .
              }
            }
          }
        }
      }
    `;
    result = await queryTriplestore(cleanupStalePropertiesQuery);
    resources = result.results.bindings.map(b => b['published'].value);
    // From all resources that have at least 1 stale property, we're going to
    // remove all properties (not only the stale ones) that have been published already.
    // The ones that are not stale and still may be published will be copied again
    // from temp graph to target graph in a next phase.
    console.log(`Cleanup ${resources.length} published resources with stale properties`);
    await forLoopProgressBar(resources, async (resource) => {
      await deleteResource(resource, this.targetGraph);
      await deleteResource(resource, this.targetGraph, { inverse: true });
    });

    // Step 3
    const cleanupLineageQuery = `
      PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
      SELECT DISTINCT ?published ?agenda
      WHERE {
        GRAPH <${this.targetGraph}> {
          ?published ext:tracesLineageTo ?agenda .
        }
        GRAPH <${this.tempGraph}> {
          ?agenda a besluitvorming:Agenda .
          FILTER NOT EXISTS {
            ?published ext:tracesLineageTo ?agenda .
          }
        }
      }
    `;

    result = await queryTriplestore(cleanupLineageQuery);
    const lineages = result.results.bindings.map(b => {
      return {
        resource: b['published'].value,
        agenda: b['agenda'].value
      };
    });
    console.log(`Cleanup lineages of ${lineages.length} published resources that must be updated`);
    await forLoopProgressBar(lineages, async (lineage) => {
      await updateSudo(`
        PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
        DELETE DATA {
          GRAPH <${this.targetGraph}> {
            <${lineage.resource}> ext:tracesLineageTo <${lineage.agenda}> .
          }
        }
      `);
    });
  }

  /*
   * Copy all triples from the temp graph to the target graph
   *
   * Depending on the configuration of USE_DIRECT_QUERIES the copy queries
   * are executed via mu-authorization (resulting in delta notifications being sent)
   * or directly on Virtuoso (without delta notifications)
   *
   * In case copy is executed via mu-authorization only new triples (triples in temp,
   * that are not yet in target graph) are copied. This strategy has following advantages:
   * - no need to be more strict (avoiding duplicates) while collecting triples in temp.
   *   Experiments have shown that collecting data in temp is rather cheap,
   *   while copying data in batches to the target graph is expensive and time-consuming.
   * - delta's are only sent for actual changes, instead of for all triples. This greatly
   *   minimizes impact on other services (mu-search, resources, ...) to update their state.
  */
  async copyTempGraph() {
    const source = this.tempGraph;
    const target = this.targetGraph;

    if (USE_DIRECT_QUERIES) {
      await runStage(`Copy triples using graph operation without delta notifications`, async () => {
        await updateTriplestore(`COPY SILENT GRAPH <${source}> TO <${target}>`);
      });
    } else {
      const queryResult = await querySudo(`
        SELECT (COUNT(*) as ?count) WHERE {
          GRAPH <${source}> { ?s ?p ?o . }
          FILTER NOT EXISTS {
            GRAPH <${target}> { ?s ?p ?o . }
          }
        }`);
      const count = parseInt(queryResult.results.bindings[0].count.value);
      console.log(`${count} triples in graph <${source}> not found in target graph <${target}>. Going to copy these triples.`);
      const limit = MU_AUTH_PAGE_SIZE;
      const totalBatches = Math.ceil(count / limit);
      console.log(`Copying ${count} triples in batches of ${MU_AUTH_PAGE_SIZE}`);
      let currentBatch = 0;
      while (currentBatch < totalBatches) {
        await runStage(`Copy triples (batch ${currentBatch + 1}/${totalBatches})`, async () => {
          // Note: no OFFSET needed in the subquery. Pagination is inherent since
          // the WHERE clause doesn't match any longer for triples that are copied in the previous batch.
          await updateSudo(`
          INSERT {
            GRAPH <${target}> {
              ?resource ?p ?o .
            }
          } WHERE {
            SELECT ?resource ?p ?o WHERE {
              GRAPH <${source}> { ?resource ?p ?o . }
              FILTER NOT EXISTS {
                GRAPH <${target}> { ?resource ?p ?o }
              }
            } LIMIT ${limit}
          }`);
        });
        currentBatch++;
      }
    }
  }
}

export default Distributor;
