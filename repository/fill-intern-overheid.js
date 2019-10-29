import mu from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import moment from 'moment';
mu.query = querySudo;

import { removeInfoNotInTemp, notConfidentialFilter, addRelatedFiles, addVisibleNewsletterInfo,
  cleanup, fillOutDetailsOnVisibleItems, addAllRelatedToAgenda, addRelatedToAgendaItemAndSubcase,
  notInternRegeringFilter, notInternOverheidFilter, logStage, runStage, addAllRelatedDocuments,
  addVisibleNotulen, transformFilter,
  cleanupBasedOnLineage, filterAgendaMustBeInSet, generateTempGraph, copyTempToTarget, addVisibleDecisions
} from './helpers';

const addVisibleAgendas = (queryEnv, extraFilters) => {
  const query = `
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
  PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  INSERT {
    GRAPH <${queryEnv.tempGraph}> {
      ?s a besluitvorming:Agenda.
      ?s ext:tracesLineageTo ?s.
    }
  } WHERE {
    GRAPH <${queryEnv.adminGraph}> {
      ?s a besluitvorming:Agenda.
      ?s ext:agendaNaam ?naam.
      FILTER(?naam != "Ontwerpagenda")
      
      ${extraFilters}
    }
  }`;
  return queryEnv.run(query, true);
};

export const fillUp = async (queryEnv, agendas) => {

  try {
    const start = moment().utc();
    await generateTempGraph(queryEnv);
    const filter = [notConfidentialFilter, notInternRegeringFilter].join("\n");
    const agendaFilter = filterAgendaMustBeInSet(agendas);
    const filterAgendasWithAccess=[
      notConfidentialFilter, notInternRegeringFilter,
      agendaFilter
    ].join("\n");
    let targetGraph = queryEnv.targetGraph;
    logStage(start, `fill overheid started at: ${start.format()}`, targetGraph);
    await runStage(`overheid agendas added`, queryEnv, () => {
      return addVisibleAgendas(queryEnv, filterAgendasWithAccess);
    });
    await runStage('related to agenda added', queryEnv, () => {
      return addAllRelatedToAgenda(queryEnv);
    });
    await runStage('related to agendaitem and subcase added', queryEnv, () => {
      return addRelatedToAgendaItemAndSubcase(queryEnv, filter);
    });
    await runStage('visible decisions added', queryEnv, () => {
      return addVisibleDecisions(queryEnv, filter);
    });
    await runStage('visible notulen added', queryEnv, () => {
      return addVisibleNotulen(queryEnv, filter);
    });
    await runStage('visible newsletter info added', queryEnv, () => {
      return addVisibleNewsletterInfo(queryEnv, filter);
    });

    await runStage('documents added', queryEnv, () => {
      return addAllRelatedDocuments(queryEnv, `
        { {
          ?agenda (besluit:isAangemaaktVoor / ext:releasedDocuments) ?date .
          } UNION {
          ?target (ext:zittingDocumentversie | (ext:beslissingsfiche / besluitvorming:heeftVersie ))  ?s .
        } }
      `);
    });
    await runStage('related files added', queryEnv, () => {
      return addRelatedFiles(queryEnv, transformFilter(filter, "?docVersion", "?docVersion (ext:file | ext:convertedFile ) ?s ."));
    });
    await runStage('details added', queryEnv, () => {
      return fillOutDetailsOnVisibleItems(queryEnv);
    });
    await runStage('lineage updated', queryEnv, () => {
      return cleanupBasedOnLineage(queryEnv, agendas);
    });
    if(queryEnv.fullRebuild){
      await runStage('removed info not in temp', queryEnv, () => {
        return removeInfoNotInTemp(queryEnv);
      });
    }
    await runStage('copy temp to target', queryEnv, () => {
      return copyTempToTarget(queryEnv);
    });
    await runStage('done filling overheid', queryEnv, () => {
      return cleanup(queryEnv);
    });
    const end = moment().utc();
    logStage(start,`fill overheid ended at: ${end.format()}`, targetGraph);
  } catch (e) {
    logStage(moment(), `${e}\n${e.stack}`, queryEnv.targetGraph);
    try {
      cleanup(queryEnv);
    }catch (e2) {
      console.log(e2);
    }
  }
};
