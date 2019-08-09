import httpContext from 'express-http-context';
import SC2 from 'sparql-client-2';
const { SparqlClient } = SC2;

//==-- logic --==//

// builds a new sparqlClient
function newSparqlClient(args) {

  let options = { requestDefaults: { headers: { } } };

  if (httpContext.get('request')) {
    options.requestDefaults.headers['mu-session-id'] = httpContext.get('request').get('mu-session-id');
    options.requestDefaults.headers['mu-call-id'] = httpContext.get('request').get('mu-call-id');
    options.requestDefaults.headers['mu-auth-allowed-groups'] = httpContext.get('request').get('mu-auth-allowed-groups'); // groups of incoming request
  }

  if (httpContext.get('response')) {
    const allowedGroups = httpContext.get('response').get('mu-auth-allowed-groups'); // groups returned by a previous SPARQL query
    if (allowedGroups)
      options.requestDefaults.headers['mu-auth-allowed-groups'] = allowedGroups;
  }

  if(args.sudo){
    options.requestDefaults.headers['mu-auth-sudo'] = 'true';
  }

  console.log(`Headers set on SPARQL client: ${JSON.stringify(options)}`);

  return new SparqlClient(args.url || process.env.MU_SPARQL_ENDPOINT, options).register({
    mu: 'http://mu.semte.ch/vocabularies/',
    muCore: 'http://mu.semte.ch/vocabularies/core/',
    muExt: 'http://mu.semte.ch/vocabularies/ext/'
  });
}

// executes a query (you can use the template syntax)
function query( args, queryString ) {
  console.log(queryString);
  return newSparqlClient(args).query(queryString).executeRaw().then(response => {
    const temp = httpContext;
    if (httpContext.get('response') && !httpContext.get('response').headersSent) {
      // set mu-auth-allowed-groups on outgoing response
      const allowedGroups = response.headers['mu-auth-allowed-groups'];
      if (allowedGroups) {
        httpContext.get('response').setHeader('mu-auth-allowed-groups', allowedGroups);
        console.log(`Update mu-auth-allowed-groups to ${allowedGroups}`);
      } else {
        httpContext.get('response').removeHeader('mu-auth-allowed-groups');
        console.log('Remove mu-auth-allowed-groups');
      }

      // set mu-auth-used-groups on outgoing response
      const usedGroups = response.headers['mu-auth-used-groups'];
      if (usedGroups) {
        httpContext.get('response').setHeader('mu-auth-used-groups', usedGroups);
        console.log(`Update mu-auth-used-groups to ${usedGroups}`);
      } else {
        httpContext.get('response').removeHeader('mu-auth-used-groups');
        console.log('Remove mu-auth-used-groups');
      }
    }

    function maybeParseJSON(body) {
      // Catch invalid JSON
      try {
        return JSON.parse(body);
      } catch (ex) {
        return null;
      }
    }

    return maybeParseJSON(response.body);
  });
};

module.exports = {
  query
};