import Distributor from '../distributor';
import { runStage } from '../timing';
import { updateTriplestore } from '../triplestore';
import { ADMIN_GRAPH, CABINET_GRAPH } from '../../constants';
import {
  collectReleasedAgendas,
  collectReleasedAgendaitems,
  collectAgendaitemActivities
} from '../collectors/agenda-collection';
import {
  collectMeetings,
  collectReleasedNewsletter
} from '../collectors/meeting-collection';
import { collectSubcasesAndCases } from '../collectors/case-collection';
import {
  collectReleasedAgendaitemTreatments,
  collectReleasedNewsitems
} from '../collectors/decision-collection';
import {
  collectReleasedDocuments,
  collectDocumentContainers,
  collectPhysicalFiles
} from '../collectors/document-collection';

/**
 * Distributor for cabinet (intern-regering) profile
 */
export default class CabinetDistributor extends Distributor {
  constructor() {
    super({
      sourceGraph: ADMIN_GRAPH,
      targetGraph: CABINET_GRAPH
    });
  }

  async collect(options) {
    await runStage('Collect agendas', async () => {
      await collectReleasedAgendas(this, options);
    }, this.constructor.name);

    await runStage('Collect meeting and agendaitems', async () => {
      await collectMeetings(this);
      await collectReleasedAgendaitems(this);
    }, this.constructor.name);

    await runStage('Collect meeting newsletter', async () => {
      await collectReleasedNewsletter(this);
    }, this.constructor.name);

    await runStage('Collect activities of agendaitems', async () => {
      await collectAgendaitemActivities(this);
    }, this.constructor.name);

    await runStage('Collect subcases and cases', async () => {
      await collectSubcasesAndCases(this);
    }, this.constructor.name);

    await runStage('Collect released and approved decisions/treatments', async () => {
      await collectReleasedAgendaitemTreatments(this);
    }, this.constructor.name);

    await runStage('Collect newsitems', async () => {
      await collectReleasedNewsitems(this);
    }, this.constructor.name);

    await runStage('Collect released documents', async () => {
      await collectReleasedDocuments(this);
    }, this.constructor.name);

    await runStage('Collect document containers', async () => {
      await collectDocumentContainers(this);
    }, this.constructor.name);

    await runStage('Collect visible files', async () => {
      await this.collectVisibleFiles();
    }, this.constructor.name);

    await runStage('Collect physical files', async () => {
      await collectPhysicalFiles(this);
    }, this.constructor.name);
  }

  /*
   * Collect all files related to any of the previously copied released documents
   * that are accessible for the cabinet-profile
   * I.e. the document is not confidential nor is it linked to a confidential case/subcase
  */
  async collectVisibleFiles() {
    const visibleFileQuery = `
      PREFIX prov: <http://www.w3.org/ns/prov#>
      PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
      PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
      INSERT {
        GRAPH <${this.tempGraph}> {
          ?file a nfo:FileDataObject ;
             ext:tracesLineageTo ?agenda .
        }
      } WHERE {
        GRAPH <${this.tempGraph}> {
          ?document a dossier:Stuk ;
              ext:tracesLineageTo ?agenda .
        }
        GRAPH <${this.sourceGraph}> {
          ?document ext:file ?file .
          FILTER NOT EXISTS {
            ?document ext:vertrouwelijk "true"^^<http://mu.semte.ch/vocabularies/typed-literals/boolean> .
          }
          FILTER NOT EXISTS {
            ?document ^prov:generated / ext:indieningVindtPlaatsTijdens / dossier:doorloopt? ?subcase .
            ?subcase ext:vertrouwelijk "true"^^<http://mu.semte.ch/vocabularies/typed-literals/boolean> .
          }
        }
      }`;
    await updateTriplestore(visibleFileQuery);
  }
}
