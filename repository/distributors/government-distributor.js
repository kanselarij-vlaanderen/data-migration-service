import Distributor from '../distributor';
import { runStage } from '../timing';
import { updateTriplestore } from '../triplestore';
import {
  ADMIN_GRAPH,
  GOVERNMENT_GRAPH,
  ACCESS_LEVEL_CABINET,
  ACCESS_LEVEL_GOVERNMENT,
  ACCESS_LEVEL_PUBLIC,
  AGENDA_TYPE,
} from '../../constants';
import { countResources } from '../query-helpers';
import {
  collectReleasedAgendas,
  collectReleasedAgendaitems,
  collectAgendaitemActivities
} from '../collectors/agenda-collection';
import {
  collectMeetings,
  collectPublicationActivities,
} from '../collectors/meeting-collection';
import { collectCasesSubcasesAndDecisionmakingFlows } from '../collectors/case-collection';
import {
  collectReleasedAgendaitemTreatments,
  collectReleasedAgendaitemDecisionActivities,
  collectReleasedNewsitems
} from '../collectors/decision-collection';
import {
  collectReleasedDocuments,
  collectDocumentContainers,
  collectPhysicalFiles
} from '../collectors/document-collection';

/**
 * Distributor for government (intern-overheid) profile
 */
export default class GovernmentDistributor extends Distributor {
  constructor() {
    super({
      sourceGraph: ADMIN_GRAPH,
      targetGraph: GOVERNMENT_GRAPH
    });

    this.releaseOptions = {
      validateDecisionsRelease: true,
      validateDocumentsRelease: true
    };
  }

  async collect(options) {
    await runStage('Collect agendas', async () => {
      await collectReleasedAgendas(this, options);
    }, this.constructor.name);

    const nbOfAgendas = await countResources({ graph: this.tempGraph, type: AGENDA_TYPE });

    if (nbOfAgendas) {
      await runStage('Collect meeting and agendaitems', async () => {
        await collectMeetings(this);
        await collectReleasedAgendaitems(this);
      }, this.constructor.name);

      await runStage('Collect publication activities of meeting', async () => {
        await collectPublicationActivities(this);
      }, this.constructor.name);

      await runStage('Collect activities of agendaitems', async () => {
        await collectAgendaitemActivities(this);
      }, this.constructor.name);

      await runStage('Collect subcases and cases', async () => {
        await collectCasesSubcasesAndDecisionmakingFlows(this);
      }, this.constructor.name);

      await runStage('Collect released and approved agenda-item treatments', async () => {
        await collectReleasedAgendaitemTreatments(this);
      }, this.constructor.name);

      await runStage('Collect released and approved decision-activities', async () => {
        await collectReleasedAgendaitemDecisionActivities(this);
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

    return nbOfAgendas > 0;
  }

  /*
   * Collect all files related to any of the previously copied released documents
   * that are accessible for the government-profile
   * I.e. the document has an access level 'Intern overheid' or 'Publiek' and is
   * not linked to a case that contains a confidential subcase.
   *
   * Note: some documents in legacy data don't have any access level and may not be
   * distributed. Therefore it's important to ensure the existence
   * of the triple `?piece ext:toegangsniveauVoorDocumentVersie ?any`.
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
          ?piece a dossier:Stuk ;
              ext:tracesLineageTo ?agenda .
        }
        GRAPH <${this.sourceGraph}> {
          ?piece ext:file ?file ;
                 ext:toegangsniveauVoorDocumentVersie ?accessLevel .
          FILTER( ?accessLevel IN (<${ACCESS_LEVEL_GOVERNMENT}>, <${ACCESS_LEVEL_PUBLIC}>) )
        }
      }`;
    await updateTriplestore(visibleFileQuery);
  }
}
