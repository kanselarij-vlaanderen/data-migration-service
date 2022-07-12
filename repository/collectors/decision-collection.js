import { updateTriplestore } from '../triplestore';
import { decisionsReleaseFilter } from './release-validations';

/**
 * Helpers to collect data about:
 * - agendaitem-treatments
 * - decision-activities
 * - newsletters
 */

/*
 * Collect related agendaitem-treatments for the relevant agendaitems
 * from the distributor's source graph in the temp graph.
 *
 * If 'validateDecisionsRelease' is enabled on the distributor's release options
 * agendaitem-treatments are only copied if decisions of the meeting have already been released.
 *
 */
async function collectReleasedAgendaitemTreatments(distributor) {
  const properties = [
    [ '^besluitvorming:heeftOnderwerp' ] // agendaitem-treatment
  ];
  const path = properties.map(prop => prop.join(' / ')).map(path => `( ${path} )`).join(' | ');

  const relatedQuery = `
      PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
      PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
      PREFIX prov: <http://www.w3.org/ns/prov#>
      INSERT {
        GRAPH <${distributor.tempGraph}> {
          ?s a ?type ;
             ext:tracesLineageTo ?agenda .
        }
      } WHERE {
        GRAPH <${distributor.tempGraph}> {
          ?agendaitem a besluit:Agendapunt ;
              ext:tracesLineageTo ?agenda .
        }
        GRAPH <${distributor.sourceGraph}> {
          ${decisionsReleaseFilter(distributor.releaseOptions.validateDecisionsRelease)}
          ?agendaitem ${path} ?s .
          ?s a ?type .
        }
      }`;
  await updateTriplestore(relatedQuery);
}

/*
 * Collect related decision-activities for the relevant agendaitems
 * from the distributor's source graph in the temp graph.
 *
 * If 'validateDecisionsRelease' is enabled on the distributor's release options
 * decision-activities are only copied if decisions of the meeting have already been released.
 *
 */
async function collectReleasedAgendaitemDecisionActivities(distributor) {
  const properties = [
    [ '^besluitvorming:heeftOnderwerp', 'besluitvorming:heeftBeslissing' ] // decision-activity
  ];
  const path = properties.map(prop => prop.join(' / ')).map(path => `( ${path} )`).join(' | ');

  const relatedQuery = `
      PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
      PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
      PREFIX prov: <http://www.w3.org/ns/prov#>
      INSERT {
        GRAPH <${distributor.tempGraph}> {
          ?s a ?type ;
             ext:tracesLineageTo ?agenda .
        }
      } WHERE {
        GRAPH <${distributor.tempGraph}> {
          ?agendaitem a besluit:Agendapunt ;
              ext:tracesLineageTo ?agenda .
        }
        GRAPH <${distributor.sourceGraph}> {
          ${decisionsReleaseFilter(distributor.releaseOptions.validateDecisionsRelease)}
          ?agendaitem ${path} ?s .
          ?s a ?type .
        }
      }`;
  await updateTriplestore(relatedQuery);
}

/*
 * Collect related newsitems for the relevant agendaitem-treatments
 * from the distributor's source graph in the temp graph.
 *
 * If 'validateDecisionsRelease' is enabled on the distributor's release options
 * newsitems are only copied if the decisions of the meeting have already been released.
 */
async function collectReleasedNewsitems(distributor) {
  const properties = [
    [ 'prov:generated' ], // newsitem
  ];
  const path = properties.map(prop => prop.join(' / ')).map(path => `( ${path} )`).join(' | ');

  const relatedQuery = `
      PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
      PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
      PREFIX prov: <http://www.w3.org/ns/prov#>
      INSERT {
        GRAPH <${distributor.tempGraph}> {
          ?s a ?type ;
             ext:tracesLineageTo ?agenda .
        }
      } WHERE {
        GRAPH <${distributor.tempGraph}> {
          ?treatment a besluit:BehandelingVanAgendapunt ;
              ext:tracesLineageTo ?agenda .
        }
        GRAPH <${distributor.sourceGraph}> {
          ${decisionsReleaseFilter(distributor.releaseOptions.validateDecisionsRelease)}
          ?treatment ${path} ?s .
          ?s a ?type .
        }
      }`;
  await updateTriplestore(relatedQuery);
}

export {
  collectReleasedAgendaitemTreatments,
  collectReleasedAgendaitemDecisionActivities,
  collectReleasedNewsitems
}
